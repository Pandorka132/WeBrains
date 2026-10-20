import type { EditorDiagnostic } from '../core/editorServices.ts'

type DiagnosticResponse = {
  type: 'diagnostics'
  requestId: number
  diagnostics: { startOffset: number; endOffset: number; message: string }[]
} | { type: 'diagnostic-error'; requestId: number; message: string }

let worker: Worker | undefined
let requestSequence = 0
const pending = new Map<number, { resolve: (items: readonly EditorDiagnostic[]) => void; reject: (error: Error) => void; cleanup: () => void }>()

function getWorker(): Worker {
  if (worker) return worker
  const created = new Worker(new URL('../core/pythonDiagnostics.worker.ts', import.meta.url), { type: 'module', name: 'python-syntax-diagnostics' })
  created.addEventListener('message', (event: MessageEvent<DiagnosticResponse>) => {
    const message = event.data
    if (!message || !('requestId' in message)) return
    const request = pending.get(message.requestId)
    if (!request) return
    request.cleanup()
    pending.delete(message.requestId)
    if (message.type === 'diagnostic-error') request.reject(new Error(message.message))
    else request.resolve(message.diagnostics.map((item) => ({ ...item, severity: 'error' as const, source: 'Python CE' })))
  })
  created.addEventListener('error', (event) => {
    const error = new Error(event.message || 'Python syntax worker failed.')
    for (const [id, request] of pending) { request.cleanup(); request.reject(error); pending.delete(id) }
    created.terminate()
    if (worker === created) worker = undefined
  })
  worker = created
  return created
}

export function diagnosePythonSyntax(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]> {
  if (signal.aborted) return Promise.resolve([])
  const id = ++requestSequence
  return new Promise((resolve, reject) => {
    const currentWorker = getWorker()
    const abort = () => {
      const request = pending.get(id)
      if (!request) return
      request.cleanup()
      pending.delete(id)
      resolve([])
    }
    const cleanup = () => signal.removeEventListener('abort', abort)
    pending.set(id, { resolve, reject, cleanup })
    signal.addEventListener('abort', abort, { once: true })
    currentWorker.postMessage({ type: 'diagnose', requestId: id, source })
  })
}

export function disposePythonSyntaxDiagnostics(): void {
  worker?.terminate()
  worker = undefined
  for (const [id, request] of pending) { request.cleanup(); request.resolve([]); pending.delete(id) }
}