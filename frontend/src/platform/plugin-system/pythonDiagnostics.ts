import type { EditorDiagnostic } from '../core/editorServices.ts'

type DiagnosticResponse = {
  type: 'diagnostics'
  requestId: number
  diagnostics: { startOffset: number; endOffset: number; message: string }[]
} | { type: 'diagnostic-error'; requestId: number; message: string }

interface PendingDiagnostics {
  readonly resolve: (diagnostics: readonly EditorDiagnostic[]) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly sourceLength: number
  readonly onAbort: () => void
}

let wasmModulePromise: Promise<WebAssembly.Module> | undefined
let parserWorker: Worker | null = null
let requestSequence = 0
const pendingDiagnostics = new Map<number, PendingDiagnostics>()

function loadParserModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    const wasmUrl = `${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-parser.js.wasm`
    wasmModulePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Python CE parser WASM: HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((error) => {
        wasmModulePromise = undefined
        throw error
      })
  }
  return wasmModulePromise
}

function settlePendingDiagnostics(error?: Error): void {
  for (const [requestId, pending] of pendingDiagnostics) {
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (error) pending.reject(error)
    else pending.resolve([])
    pendingDiagnostics.delete(requestId)
  }
}

function getParserWorker(): Worker {
  if (parserWorker) return parserWorker

  const worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-parser.worker.js`, { name: 'python-ce-parser' })
  worker.addEventListener('message', (event: MessageEvent<DiagnosticResponse>) => {
    const message = event.data
    if (!message || (message.type !== 'diagnostics' && message.type !== 'diagnostic-error')) return
    const pending = pendingDiagnostics.get(message.requestId)
    if (!pending) return
    pendingDiagnostics.delete(message.requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (message.type === 'diagnostic-error') {
      pending.reject(new Error(message.message))
      return
    }
    const diagnostics = message.diagnostics
      .filter((item) => Number.isInteger(item.startOffset)
        && Number.isInteger(item.endOffset)
        && item.startOffset >= 0
        && item.endOffset > item.startOffset
        && item.endOffset <= pending.sourceLength
        && typeof item.message === 'string')
      .map((item) => ({ ...item, severity: 'error' as const, source: 'Python CE parser' }))
    pending.resolve(diagnostics)
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Python CE parser worker failed.')
    worker.terminate()
    if (parserWorker === worker) parserWorker = null
    settlePendingDiagnostics(error)
  })
  parserWorker = worker
  return worker
}

export async function diagnosePythonSyntax(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]> {
  if (signal.aborted || source.length === 0) return []
  const wasmModule = await loadParserModule()
  if (signal.aborted) return []

  const worker = getParserWorker()
  const requestId = ++requestSequence
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pendingDiagnostics.delete(requestId)
      worker.postMessage({ type: 'cancel', requestId })
      resolve([])
    }
    pendingDiagnostics.set(requestId, { resolve, reject, signal, sourceLength: source.length, onAbort })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    worker.postMessage({ type: 'diagnose', requestId, source, wasmModule })
  })
}

export function disposePythonSyntaxDiagnostics(): void {
  parserWorker?.terminate()
  parserWorker = null
  settlePendingDiagnostics()
  wasmModulePromise = undefined
}
