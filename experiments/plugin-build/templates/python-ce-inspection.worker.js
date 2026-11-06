/* One persistent worker serializes original Python CE unresolved-reference inspections. */
let queuedRequest = null;
let running = false;
let activeRequestId = null;
let activeRequestProducedDiagnostics = false;
const nativeLog = console.log.bind(console);

console.log = (...values) => {
  const line = values.map((value) => String(value)).join(" ");
  if (line.startsWith("INSPECTION_JSON:")) {
    try {
      const diagnostics = JSON.parse(line.slice("INSPECTION_JSON:".length));
      if (!Array.isArray(diagnostics)) throw new TypeError("Inspection output must be a JSON array");
      activeRequestProducedDiagnostics = true;
      self.postMessage({ type: "diagnostics", requestId: activeRequestId, diagnostics });
    } catch (error) {
      self.postMessage({ type: "diagnostic-error", requestId: activeRequestId, message: "Could not parse Python CE inspection output: " + String(error) });
    }
    return;
  }
  if (line.startsWith("STAGE:") || line.startsWith("INSPECTION_PROBLEM")
      || line.startsWith("UNRESOLVED_REFERENCE_FOUND=") || line.startsWith("INSPECTION_PROBLEMS=")
      || line.startsWith("TEST_HARNESS_CLEANUP:")) return;
  nativeLog(...values);
};

async function drainQueue() {
  if (running || !queuedRequest || typeof globalThis.__webrainsStart !== "function") return;
  const request = queuedRequest;
  queuedRequest = null;
  running = true;
  activeRequestId = request.requestId;
  activeRequestProducedDiagnostics = false;
  globalThis.__webrainsRequestId = request.requestId;
  globalThis.__webrainsWasmModule = request.wasmModule;
  try {
    await globalThis.__webrainsStart(request.source);
  } catch (error) {
    self.postMessage({ type: "diagnostic-error", requestId: request.requestId, message: String(error) });
  } finally {
    if (!activeRequestProducedDiagnostics) {
      self.postMessage({ type: "diagnostics", requestId: request.requestId, diagnostics: [] });
    }
    running = false;
    activeRequestId = null;
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

importScripts("./python-ce-inspection-indexed-wasmlm.js");
void drainQueue();
