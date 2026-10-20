// Official Pyodide module-worker setup, pinned to release 314.0.7.
// https://pyodide.org/en/stable/usage/webworker.html
import { PYODIDE_INDEX_URL } from './pyodideVersion.ts'

type RunRequest = { type: 'run'; targetMode: 'script' | 'module'; scriptPath: string; moduleName: string; workingDirectory: string; redirectInput: boolean; inputFile: string; args: string[]; files: { path: string; content: string }[]; inputBuffer?: SharedArrayBuffer }
type WorkerRequest = { type: 'initialize' } | RunRequest
const indexURL = PYODIDE_INDEX_URL
const pyodideModuleURL = `${indexURL}pyodide.mjs`
type PyodideRuntime = {
  readonly FS: { mkdirTree(path: string): void; writeFile(path: string, data: string | Uint8Array): void; readFile(path: string, options?: { encoding?: string }): string | Uint8Array }
  readonly globals: { set(name: string, value: unknown): void }
  setStdout(options: { batched: (text: string) => void }): void
  setStderr(options: { batched: (text: string) => void }): void
  setStdin(options: { stdin: () => string | null }): void
  loadPackagesFromImports(source: string): Promise<void>
  runPython(source: string): unknown
  runPythonAsync(source: string): Promise<unknown>
}
type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideRuntime>
let pyodidePromise: ReturnType<LoadPyodide> | undefined
let inputSequence = 0
const preparedPythonSources = new Map<string, string>()

async function getPyodide(): Promise<PyodideRuntime> {
  // Runtime module and its WASM/package assets are loaded from the same pinned official release.
  // A single promise prevents duplicate initialization if the host sends initialize and run close together.
  const { loadPyodide } = await import(/* @vite-ignore */ pyodideModuleURL) as { loadPyodide: LoadPyodide }
  return await (pyodidePromise ??= loadPyodide({ indexURL }))
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === 'initialize') {
    self.postMessage({ type: 'status', status: 'starting', message: 'Loading Pyodide runtime…' })
    try {
      await getPyodide()
      self.postMessage({ type: 'ready' })
    } catch (error) {
      self.postMessage({ type: 'error', message: `Could not initialize Pyodide: ${error instanceof Error ? error.message : String(error)}` })
    }
    return
  }
  if (event.data.type !== 'run') return
  const request = event.data
  try {
    const pyodide = await getPyodide()
    pyodide.setStdout({ batched: (text: string) => self.postMessage({ type: 'stdout', text }) })
    pyodide.setStderr({ batched: (text: string) => self.postMessage({ type: 'stderr', text }) })
    const projectRoot = '/home/pyodide/project'
    // Keep the interpreter warm while refreshing only the project-specific state for this run.
    pyodide.runPython(`
import os, shutil, sys
__webbrains_root = ${JSON.stringify(projectRoot)}
for __webbrains_name, __webbrains_module in list(sys.modules.items()):
    __webbrains_file = getattr(__webbrains_module, "__file__", None)
    if __webbrains_file and os.path.abspath(__webbrains_file).startswith(__webbrains_root + os.sep):
        sys.modules.pop(__webbrains_name, None)
sys.path[:] = [__webbrains_path for __webbrains_path in sys.path if not os.path.abspath(__webbrains_path or os.getcwd()).startswith(__webbrains_root)]
shutil.rmtree(__webbrains_root, ignore_errors=True)
os.makedirs(__webbrains_root, exist_ok=True)
`)
    pyodide.FS.mkdirTree(projectRoot)
    for (const file of request.files) {
      const destination = `${projectRoot}/${file.path}`
      pyodide.FS.mkdirTree(destination.slice(0, destination.lastIndexOf('/')))
      pyodide.FS.writeFile(destination, file.content)
    }
    const scriptPath = `${projectRoot}/${request.scriptPath}`
    pyodide.globals.set('__webbrains_script_path', scriptPath)
    pyodide.globals.set('__webbrains_module_name', request.moduleName)
    pyodide.globals.set('__webbrains_arguments', request.args)
    pyodide.globals.set('__webbrains_redirect_input', request.redirectInput)
    pyodide.globals.set('__webbrains_input_file', `${projectRoot}/${request.inputFile}`)
    if (request.targetMode === 'module') await pyodide.loadPackagesFromImports(`import ${request.moduleName}`)
    const currentPythonPaths = new Set(request.files.filter((file) => file.path.endsWith('.py')).map((file) => file.path))
    for (const path of preparedPythonSources.keys()) if (!currentPythonPaths.has(path)) preparedPythonSources.delete(path)
    for (const file of request.files) {
      if (file.path.endsWith('.py') && preparedPythonSources.get(file.path) !== file.content) {
        await pyodide.loadPackagesFromImports(file.content)
        preparedPythonSources.set(file.path, file.content)
      }
    }
    pyodide.setStdin({ stdin: () => readLine(request.inputBuffer) })
    self.postMessage({ type: 'status', status: 'running', message: 'Running Python program…' })
    const exitCode = await pyodide.runPythonAsync(`
import os, runpy, sys
if '__webbrains_default_stdin' not in globals():
    __webbrains_default_stdin = sys.stdin
sys.stdin = __webbrains_default_stdin
os.chdir(os.path.join(${JSON.stringify(projectRoot)}, ${JSON.stringify(request.workingDirectory)}))
if __webbrains_redirect_input:
    sys.stdin = open(__webbrains_input_file, encoding="utf-8")
if ${JSON.stringify(request.targetMode)} == "module":
    sys.path.insert(0, os.getcwd())
    sys.argv = [__webbrains_module_name, *list(__webbrains_arguments)]
else:
    sys.path.insert(0, os.path.dirname(__webbrains_script_path))
    sys.argv = [${JSON.stringify(request.scriptPath)}, *list(__webbrains_arguments)]
__webbrains_exit_code = 0
try:
    if ${JSON.stringify(request.targetMode)} == "module":
        runpy.run_module(__webbrains_module_name, run_name="__main__", alter_sys=True)
    else:
        runpy.run_path(__webbrains_script_path, run_name="__main__")
except SystemExit as error:
    if error.code is None:
        __webbrains_exit_code = 0
    elif isinstance(error.code, int):
        __webbrains_exit_code = error.code
    else:
        print(error.code, file=sys.stderr)
        __webbrains_exit_code = 1
__webbrains_exit_code
`)
    self.postMessage({ type: 'finished', exitCode: Number(exitCode) })
  } catch (error) {
    self.postMessage({ type: 'stderr', text: `${error instanceof Error ? error.message : String(error)}\n` })
    self.postMessage({ type: 'finished', exitCode: 1 })
  }
}

function readLine(buffer?: SharedArrayBuffer): string | null {
  if (!buffer) {
    self.postMessage({ type: 'stderr', text: 'Interactive input() requires cross-origin isolation headers (COOP/COEP) on this static host.\n' })
    return null
  }
  const requestId = `stdin-${++inputSequence}`
  self.postMessage({ type: 'input-request', requestId, prompt: '', available: true })
  const control = new Int32Array(buffer, 0, 4)
  Atomics.store(control, 0, 0)
  self.postMessage({ type: 'status', status: 'waiting-input' })
  while (Atomics.load(control, 0) === 0) Atomics.wait(control, 0, 0)
  if (Atomics.load(control, 0) === 3) return null
  const length = Atomics.load(control, 1)
  const value = new TextDecoder().decode(new Uint8Array(buffer, 16, length))
  self.postMessage({ type: 'status', status: 'running' })
  return value
}
