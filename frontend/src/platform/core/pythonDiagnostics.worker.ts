import { mapPythonSyntaxError } from './pythonSyntax.ts'
import { PYODIDE_INDEX_URL } from './pyodideVersion.ts'

type PyodideRuntime = {
  readonly globals: { set(name: string, value: unknown): void; delete(name: string): void }
  runPython(source: string): unknown
}
type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideRuntime>
type DiagnoseRequest = { type: 'diagnose'; requestId: number; source: string }
const indexURL = PYODIDE_INDEX_URL
const pyodideModuleURL = `${indexURL}pyodide.mjs`
let pyodidePromise: ReturnType<LoadPyodide> | undefined

self.onmessage = async (event: MessageEvent<DiagnoseRequest>) => {
  const request = event.data
  if (request.type !== 'diagnose' || !Number.isInteger(request.requestId)) return
  try {
    const { loadPyodide } = await import(/* @vite-ignore */ pyodideModuleURL) as { loadPyodide: LoadPyodide }
    const pyodide = await (pyodidePromise ??= loadPyodide({ indexURL }))
    pyodide.globals.set('__webbrains_diagnostic_source', request.source)
    try {
      const serialized = pyodide.runPython(`
import json
try:
    compile(__webbrains_diagnostic_source, '<editor>', 'exec')
    json.dumps(None)
except SyntaxError as error:
    json.dumps({
        'message': error.msg,
        'line': error.lineno or 1,
        'column': error.offset or 1,
        'endLine': error.end_lineno or error.lineno or 1,
        'endColumn': error.end_offset or ((error.offset or 1) + 1),
    })
`)
      const issue = JSON.parse(serialized as string) as { message: string; line: number; column: number; endLine: number; endColumn: number } | null
      const diagnostic = issue ? mapPythonSyntaxError(request.source, issue) : null
      self.postMessage({ type: 'diagnostics', requestId: request.requestId, diagnostics: diagnostic ? [diagnostic] : [] })
    } finally {
      pyodide.globals.delete('__webbrains_diagnostic_source')
    }
  } catch (error) {
    self.postMessage({ type: 'diagnostic-error', requestId: request.requestId, message: error instanceof Error ? error.message : String(error) })
  }
}
