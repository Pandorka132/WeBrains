/* One persistent worker serializes original Python CE parser invocations. */
let queuedRequest = null;
let running = false;
let activeRequestId = null;
const nativeLog = console.log.bind(console);

console.log = (...values) => {
  const line = values.map((value) => String(value)).join(" ");
  if (line.startsWith("PARSER_JSON:")) {
    try {
      self.postMessage({
        type: "diagnostics",
        requestId: activeRequestId,
        diagnostics: JSON.parse(line.slice("PARSER_JSON:".length)).map((item) => ({
          startOffset: item.start,
          endOffset: item.end,
          message: item.message,
        })),
      });
    } catch (error) {
      self.postMessage({ type: "diagnostic-error", requestId: activeRequestId, message: "Could not parse Python CE parser output: " + String(error) });
    }
    return;
  }
  if (line.startsWith("STAGE:") || line.startsWith("PARSER_OK")) return;
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
    self.postMessage({ type: "diagnostic-error", requestId: request.requestId, message: String(error) });
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
  if (message?.type !== "diagnose" || typeof message.source !== "string"
      || !Number.isInteger(message.requestId) || !(message.wasmModule instanceof WebAssembly.Module)) return;
  // Keep only the newest waiting snapshot; an in-flight WASM invocation is allowed to finish.
  queuedRequest = { requestId: message.requestId, source: message.source, wasmModule: message.wasmModule };
  void drainQueue();
};

importScripts("./python-ce-parser.js");
void drainQueue();
