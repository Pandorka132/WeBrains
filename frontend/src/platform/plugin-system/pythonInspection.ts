import type { EditorDiagnostic } from '../core/editorServices.ts'

type InspectionResponse = {
  readonly type: 'diagnostics'
  readonly requestId: number
  readonly diagnostics: readonly { readonly startOffset: number; readonly endOffset: number; readonly message: string }[]
} | {
  readonly type: 'diagnostic-error'
  readonly requestId: number
  readonly message: string
}

interface PendingInspection {
  readonly resolve: (diagnostics: readonly EditorDiagnostic[]) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly sourceLength: number
  readonly onAbort: () => void
}

let wasmModulePromise: Promise<WebAssembly.Module> | undefined
let inspectionWorker: Worker | null = null
let requestSequence = 0
const pendingInspections = new Map<number, PendingInspection>()

function loadInspectionModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    const wasmUrl = `${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-inspection-indexed-wasmlm.js.wasm`
    wasmModulePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Python CE unresolved-reference inspection WASM: HTTP ${response.status}`)
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

function settlePendingInspections(error?: Error): void {
  for (const [requestId, pending] of pendingInspections) {
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (error) pending.reject(error)
    else pending.resolve([])
    pendingInspections.delete(requestId)
  }
}

function getInspectionWorker(): Worker {
  if (inspectionWorker) return inspectionWorker

  const worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-inspection.worker.js`, { name: 'python-ce-unresolved-inspection' })
  worker.addEventListener('message', (event: MessageEvent<InspectionResponse>) => {
    const message = event.data
    if (!message || (message.type !== 'diagnostics' && message.type !== 'diagnostic-error')) return
    const pending = pendingInspections.get(message.requestId)
    if (!pending) return
    pendingInspections.delete(message.requestId)
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
        && typeof item.message === 'string'
        && item.message.length > 0)
      .map((item) => ({ ...item, severity: 'error' as const, source: 'Python CE · PyUnresolvedReferencesInspection' }))
    pending.resolve(diagnostics)
  })
  worker.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Python CE unresolved-reference inspection worker failed.')
    worker.terminate()
    if (inspectionWorker === worker) inspectionWorker = null
    settlePendingInspections(error)
  })
  inspectionWorker = worker
  return worker
}

/** Runs the original Python CE unresolved-reference inspection in its dedicated WASM worker. */
export async function diagnosePythonReferences(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]> {
  if (signal.aborted || source.length === 0) return []
  const wasmModule = await loadInspectionModule()
  if (signal.aborted) return []

  const worker = getInspectionWorker()
  const requestId = ++requestSequence
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      pendingInspections.delete(requestId)
      worker.postMessage({ type: 'cancel', requestId })
      resolve([])
    }
    pendingInspections.set(requestId, { resolve, reject, signal, sourceLength: source.length, onAbort })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    worker.postMessage({ type: 'diagnose', requestId, source, wasmModule })
  })
}

export function disposePythonReferenceDiagnostics(): void {
  inspectionWorker?.terminate()
  inspectionWorker = null
  settlePendingInspections()
  wasmModulePromise = undefined
}
