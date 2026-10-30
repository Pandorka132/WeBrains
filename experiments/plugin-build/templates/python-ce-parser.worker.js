/* Run the original Python CE ParserDefinition/PyParser once per source snapshot. */
let pendingRequest = null;
let started = false;
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

function start(request) {
  if (started) return;
  started = true;
  activeRequestId = request.requestId;
  globalThis.__pythonCeRequestId = request.requestId;
  globalThis.__pythonCeWasmModule = request.wasmModule;
  Promise.resolve(globalThis.__pythonCeStart(request.source)).catch((error) => {
    self.postMessage({ type: "diagnostic-error", requestId: request.requestId, message: String(error) });
  });
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== "diagnose" || typeof message.source !== "string" || started
      || !(message.wasmModule instanceof WebAssembly.Module)) return;
  const request = { requestId: message.requestId, source: message.source, wasmModule: message.wasmModule };
  if (typeof globalThis.__pythonCeStart === "function") start(request);
  else pendingRequest = request;
};

importScripts("./python-ce-parser.js");
if (pendingRequest) start(pendingRequest);
