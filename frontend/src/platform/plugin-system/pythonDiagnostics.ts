import type { EditorDiagnostic } from '../core/editorServices.ts'

type DiagnosticResponse = {
  type: 'diagnostics'
  requestId: number
  diagnostics: { startOffset: number; endOffset: number; message: string }[]
} | { type: 'diagnostic-error'; requestId: number; message: string }

let wasmModulePromise: Promise<WebAssembly.Module> | undefined
let requestSequence = 0

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

export async function diagnosePythonSyntax(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]> {
  if (signal.aborted || source.length === 0) return []
  const wasmModule = await loadParserModule()
  if (signal.aborted) return []

  const requestId = ++requestSequence
  return new Promise((resolve, reject) => {
    const worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-parser.worker.js`, { name: 'python-ce-parser' })
    let settled = false
    const cleanup = () => {
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }
    const abort = () => finish(() => resolve([]))

    worker.addEventListener('message', (event: MessageEvent<DiagnosticResponse>) => {
      const message = event.data
      if (!message || message.requestId !== requestId) return
      if (message.type === 'diagnostic-error') {
        finish(() => reject(new Error(message.message)))
        return
      }
      const diagnostics = message.diagnostics
        .filter((item) => Number.isInteger(item.startOffset)
          && Number.isInteger(item.endOffset)
          && item.startOffset >= 0
          && item.endOffset > item.startOffset
          && item.endOffset <= source.length
          && typeof item.message === 'string')
        .map((item) => ({ ...item, severity: 'error' as const, source: 'Python CE parser' }))
      finish(() => resolve(diagnostics))
    })
    worker.addEventListener('error', (event) => finish(() => reject(new Error(event.message || 'Python CE parser worker failed.'))))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    worker.postMessage({ type: 'diagnose', requestId, source, wasmModule })
  })
}

export function disposePythonSyntaxDiagnostics(): void {
  // Each parser request owns and terminates its worker. The compiled module is safely reusable.
  wasmModulePromise = undefined
}
