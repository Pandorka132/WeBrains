/* One worker runs one original Python CE lexer invocation. */
let activeRequestId = null;
let pendingRequest = null;
let started = false;
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

function start(request) {
  if (started) return;
  started = true;
  activeRequestId = request.requestId;
  globalThis.__pythonCeRequestId = request.requestId;
  globalThis.__pythonCeWasmModule = request.wasmModule;
  try {
    globalThis.__pythonCeStart(request.source);
  } catch (error) {
    self.postMessage({ type: "error", requestId: request.requestId, message: String(error) });
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== "tokenize" || typeof message.source !== "string" || started
      || !(message.wasmModule instanceof WebAssembly.Module)) return;
  const request = { requestId: message.requestId, source: message.source, wasmModule: message.wasmModule };
  if (typeof globalThis.__pythonCeStart === "function") start(request);
  else pendingRequest = request;
};

importScripts("./python-ce-lexer.js");
if (pendingRequest) start(pendingRequest);
