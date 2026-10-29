/* Run the original Python CE keyword contributor in a worker for each lookup request. */
let activeRequestId = null;
let running = false;
const pendingRequests = [];
const nativeLog = console.log.bind(console);

console.log = (...values) => {
  const line = values.map((value) => String(value)).join(" ");
  if (line.startsWith("COMPLETION_JSON=")) {
    try {
      self.postMessage({
        type: "completion",
        requestId: activeRequestId,
        items: JSON.parse(line.slice("COMPLETION_JSON=".length)).map((label) => ({ label })),
      });
    } catch (error) {
      self.postMessage({
        type: "error",
        requestId: activeRequestId,
        message: "Could not parse Python CE completion output: " + String(error),
      });
    }
    return;
  }
  if (line.startsWith("PROBE_STAGE=") || line.startsWith("COMPLETION_ITEMS=")
      || line.startsWith("COMPLETION_COUNT=") || line.startsWith("ORIGINAL_CONTRIBUTOR=")
      || line.startsWith("SOURCE=") || line.startsWith("PSI=") || line.startsWith("OFFSET=")) return;
  nativeLog(...values);
};

async function drainQueue() {
  if (running || typeof globalThis.__pythonCeStart !== "function") return;
  const request = pendingRequests.shift();
  if (!request) return;
  running = true;
  activeRequestId = request.requestId;
  globalThis.__pythonCeRequestId = request.requestId;
  globalThis.__pythonCeWasmModule = request.wasmModule;
  try {
    await globalThis.__pythonCeStart(request.source, request.caretOffset);
  } catch (error) {
    self.postMessage({ type: "error", requestId: request.requestId, message: String(error) });
  } finally {
    running = false;
    void drainQueue();
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type !== "complete" || typeof message.source !== "string"
      || !Number.isInteger(message.caretOffset) || !(message.wasmModule instanceof WebAssembly.Module)) return;
  pendingRequests.push({
    requestId: message.requestId,
    source: message.source,
    caretOffset: message.caretOffset,
    wasmModule: message.wasmModule,
  });
  void drainQueue();
};

importScripts("./python-ce-completion.js");
void drainQueue();
