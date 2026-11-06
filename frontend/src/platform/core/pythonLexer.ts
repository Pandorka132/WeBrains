export interface PythonLexerToken {
  readonly type: string
  readonly start: number
  readonly end: number
  readonly text: string
}

interface LexerResponse {
  readonly type?: string
  readonly requestId?: number
  readonly tokens?: readonly PythonLexerToken[]
  readonly message?: string
}

interface PendingTokenization {
  readonly resolve: (tokens: readonly PythonLexerToken[]) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal
  readonly onAbort: () => void
}

let wasmModulePromise: Promise<WebAssembly.Module> | null = null
let lexerWorker: Worker | null = null
let nextRequestId = 0
const pendingTokenizations = new Map<number, PendingTokenization>()

function loadPythonLexerWasmModule(): Promise<WebAssembly.Module> {
  if (!wasmModulePromise) {
    const wasmUrl = `${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-lexer.js.wasm`
    wasmModulePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Python lexer WASM: HTTP ${response.status}`)
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

function settlePendingTokenizations(error?: Error): void {
  for (const [requestId, pending] of pendingTokenizations) {
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (error) pending.reject(error)
    else pending.resolve([])
    pendingTokenizations.delete(requestId)
  }
}

function getLexerWorker(): Worker {
  if (lexerWorker) return lexerWorker

  const worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-lexer.worker.js`, { name: 'python-ce-lexer' })
  worker.onmessage = (event: MessageEvent<LexerResponse>) => {
    const message = event.data
    if ((message.type !== 'tokens' && message.type !== 'error') || typeof message.requestId !== 'number') return
    const pending = pendingTokenizations.get(message.requestId)
    if (!pending) return
    pendingTokenizations.delete(message.requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    if (message.type === 'tokens') pending.resolve(message.tokens ?? [])
    else pending.reject(new Error(message.message ?? 'Python CE lexer failed'))
  }
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Python CE lexer worker failed')
    worker.terminate()
    if (lexerWorker === worker) lexerWorker = null
    settlePendingTokenizations(error)
  }
  lexerWorker = worker
  return worker
}

/** Tokenizes source through one persistent Python CE worker. */
export async function tokenizePython(source: string, signal: AbortSignal): Promise<readonly PythonLexerToken[]> {
  if (signal.aborted) return []
  const wasmModule = await loadPythonLexerWasmModule()
  if (signal.aborted) return []

  const worker = getLexerWorker()
  const requestId = ++nextRequestId
  return new Promise<readonly PythonLexerToken[]>((resolve, reject) => {
    const onAbort = () => {
      pendingTokenizations.delete(requestId)
      worker.postMessage({ type: 'cancel', requestId })
      resolve([])
    }
    pendingTokenizations.set(requestId, { resolve, reject, signal, onAbort })
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) {
      onAbort()
      return
    }
    worker.postMessage({ type: 'tokenize', requestId, source, wasmModule })
  })
}

export function disposePythonLexer(): void {
  lexerWorker?.terminate()
  lexerWorker = null
  settlePendingTokenizations()
  wasmModulePromise = null
}
