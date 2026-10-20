declare module 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs' {
  export interface PyodideRuntime {
    readonly FS: {
      mkdirTree(path: string): void
      rm(path: string, options?: { recursive?: boolean }): void
      writeFile(path: string, data: string | Uint8Array): void
      readFile(path: string, options?: { encoding?: string }): string | Uint8Array
    }
    readonly globals: {
      set(name: string, value: unknown): void
      delete(name: string): void
    }
    setStdout(options: { batched: (text: string) => void }): void
    setStderr(options: { batched: (text: string) => void }): void
    setStdin(options: { stdin: () => string | null }): void
    loadPackagesFromImports(source: string): Promise<void>
    runPython(source: string): unknown
    runPythonAsync(source: string): Promise<unknown>
  }

  export function loadPyodide(options: { indexURL: string }): Promise<PyodideRuntime>
}
