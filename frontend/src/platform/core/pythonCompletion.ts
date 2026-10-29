import type { EditorCompletionContributor, EditorCompletionItem } from './editorServices.ts'

interface CompletionWorkerMessage {
  readonly type?: string
  readonly requestId?: number | null
  readonly items?: readonly EditorCompletionItem[]
  readonly message?: string
}

interface PendingCompletion {
  readonly resolve: (items: readonly EditorCompletionItem[]) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly onAbort: () => void
}

let wasmModulePromise: Promise<WebAssembly.Module> | null = null
let completionWorker: Worker | null = null
let nextRequestId = 0
const pendingCompletions = new Map<number, PendingCompletion>()

function loadPythonCompletionWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    const wasmUrl = `${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-completion.js.wasm`
    wasmModulePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Python completion WASM: HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((error: unknown) => {
        wasmModulePromise = null
        throw error
      })
  }
  return wasmModulePromise
}

function failPendingCompletions(error: Error): void {
  for (const [requestId, pending] of pendingCompletions) {
    pending.signal.removeEventListener('abort', pending.onAbort)
    pending.reject(error)
    pendingCompletions.delete(requestId)
  }
}

function getCompletionWorker(): Worker {
  if (completionWorker) return completionWorker
  const worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-completion.worker.js`, { name: 'python-ce-completion' })
  worker.onmessage = (event: MessageEvent<CompletionWorkerMessage>) => {
    const message = event.data
    if ((message.type !== 'completion' && message.type !== 'error') || typeof message.requestId !== 'number') return
    const pending = pendingCompletions.get(message.requestId)
    if (!pending) return
    pendingCompletions.delete(message.requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (message.type === 'completion') pending.resolve(message.items ?? [])
    else pending.reject(new Error(message.message ?? 'Python CE completion failed'))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Python CE completion worker failed')
    worker.terminate()
    if (completionWorker === worker) completionWorker = null
    failPendingCompletions(error)
  }
  completionWorker = worker
  return worker
}

async function requestPythonCeCompletion(
  source: string,
  caretOffset: number,
  signal: AbortSignal,
): Promise<readonly EditorCompletionItem[]> {
  if (signal.aborted) return []
  const wasmModule = await loadPythonCompletionWasmModule()
  if (signal.aborted) return []
  const worker = getCompletionWorker()
  const requestId = ++nextRequestId

  return new Promise<readonly EditorCompletionItem[]>((resolve, reject) => {
    const onAbort = () => {
      pendingCompletions.delete(requestId)
      resolve([])
    }
    const pending: PendingCompletion = { resolve, reject, signal, onAbort }
    pendingCompletions.set(requestId, pending)
    signal.addEventListener('abort', onAbort, { once: true })
    worker.postMessage({ type: 'complete', requestId, source, caretOffset, wasmModule })
  })
}

/**
 * Adapter for the original Python CE keyword contributor. All lookup items are produced by
 * PyKeywordCompletionContributor in the Web Image worker; this module does not infer candidates.
 */
export const pythonCeKeywordCompletionContributor: EditorCompletionContributor = {
  id: 'python-ce.original-keyword-completion',
  languageId: 'python',
  contribute: ({ source, caretOffset, signal }) => requestPythonCeCompletion(source, caretOffset, signal),
}
