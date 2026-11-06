/* One persistent worker serializes original Python CE lexer invocations. */
let activeRequestId = null;
let queuedRequest = null;
let running = false;
const nativeLog = console.log.bind(console);

console.log = (...values) => {
  const line = values.map((value) => String(value)).join(" ");
  if (line.startsWith("LEXER_JSON:")) {
    try {
      self.postMessage({
        type: "tokens",
        requestId: activeRequestId,
        tokens: JSON.parse(line.slice("LEXER_JSON:".length)),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId: activeRequestId,
        message: "Could not parse Python CE lexer output: " + String(error),
      });
    }
    return;
  }
  if (line.startsWith("LEXER_OK") || line.startsWith("LEXER_API_OK")) return;
  nativeLog(...values);
};

async function drainQueue() {
  if (running || !queuedRequest || typeof globalThis.__webrainsStart !== "function") return;
  const request = queuedRequest;
  queuedRequest = null;
  running = true;
  activeRequestId = request.requestId;
  globalThis.__webrainsRequestId = request.requestId;
  globalThis.__webrainsWasmModule = request.wasmModule;
  try {
    await globalThis.__webrainsStart(request.source);
  } catch (error) {
    self.postMessage({ type: "error", requestId: request.requestId, message: String(error) });
  } finally {
    running = false;
    void drainQueue();
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type === "cancel" && Number.isInteger(message.requestId)) {
    if (queuedRequest?.requestId === message.requestId) queuedRequest = null;
    return;
  }
  if (message?.type !== "tokenize" || typeof message.source !== "string"
      || !Number.isInteger(message.requestId) || !(message.wasmModule instanceof WebAssembly.Module)) return;
  // Keep only the newest waiting snapshot; an in-flight WASM invocation is allowed to finish.
  queuedRequest = { requestId: message.requestId, source: message.source, wasmModule: message.wasmModule };
  void drainQueue();
};

importScripts("./python-ce-lexer.js");
void drainQueue();
