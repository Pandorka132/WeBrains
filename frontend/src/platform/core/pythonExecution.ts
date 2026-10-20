import type { RunConfigurationRecord, RunConfigurationType, RunExecutor } from './execution.ts'
import { isLikelyBinaryFileName } from './vfs.ts'
import type { VirtualFile } from './vfs.ts'
import { parseCommandLineArguments } from './execution.ts'
export { PYODIDE_VERSION } from './pyodideVersion.ts'

export type PythonRunOptions = {
  targetMode?: 'script' | 'module'
  scriptPath?: string
  moduleName?: string
  arguments?: string
  workingDirectory?: string
  redirectInput?: boolean
  inputFile?: string
}
export const PYTHON_RUN_CONFIGURATION_ID = 'python-ce.run'
export const PYTHON_EXECUTOR_ID = 'python-ce.pyodide'

export const pythonRunConfigurationType: RunConfigurationType<PythonRunOptions> = {
  id: PYTHON_RUN_CONFIGURATION_ID,
  pluginId: 'PythonCore',
  displayName: 'Python',
  icon: 'python.svg',
  executorId: PYTHON_EXECUTOR_ID,
  fields: [
    { id: 'targetMode', label: 'Run target', kind: 'choice', choices: [{ value: 'script', label: 'Script path' }, { value: 'module', label: 'Module name' }], description: 'Choose whether to execute a project file or a Python module.' },
    { id: 'scriptPath', label: 'Script path', kind: 'path', placeholder: 'main.py', description: 'Project-relative Python file to execute.', visibleWhen: { field: 'targetMode', value: 'script' } },
    { id: 'moduleName', label: 'Module name', kind: 'text', placeholder: 'package.module', description: 'Qualified Python module name, equivalent to python -m.', visibleWhen: { field: 'targetMode', value: 'module' } },
    { id: 'arguments', label: 'Program arguments', kind: 'text', placeholder: '"hello world" --count 2', description: 'Arguments are split into argv without shell expansion.' },
    { id: 'workingDirectory', label: 'Working directory', kind: 'path', placeholder: '.', description: 'Project-relative directory; leave empty to use the project root.' },
    { id: 'redirectInput', label: 'Redirect input from file', kind: 'boolean', description: 'Read standard input from a project text file instead of the interactive console.' },
    { id: 'inputFile', label: 'Input file', kind: 'path', placeholder: 'input.txt', description: 'Project-relative text file used as stdin.', visibleWhen: { field: 'redirectInput', value: 'true' } },
  ],
  createDefault(project) {
    const scriptPath = project.activeFile?.toLowerCase().endsWith('.py') ? project.activeFile : 'main.py'
    const suggestedName = scriptPath.split('/').at(-1)?.replace(/\.py$/i, '') || 'Python'
    return {
      id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `python-${Date.now().toString(36)}`, typeId: PYTHON_RUN_CONFIGURATION_ID,
      name: suggestedName, options: { targetMode: 'script', scriptPath, moduleName: '', arguments: '', workingDirectory: '', redirectInput: false, inputFile: '' },
    }
  },
  validate(configuration, files) {
    const options = configuration.options as PythonRunOptions | undefined
    const targetMode = options?.targetMode === 'module' ? 'module' : 'script'
    const issues = []
    if (targetMode === 'script') {
      const path = typeof options?.scriptPath === 'string' ? options.scriptPath.trim() : ''
      if (!path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..')) {
        issues.push({ field: 'scriptPath', message: 'Script path must be a project-relative file path.' })
      } else {
        const file = files.find(path)
        if (!file || file.isDirectory) issues.push({ field: 'scriptPath', message: `Python script not found: ${path}` })
        else if (!path.toLowerCase().endsWith('.py')) issues.push({ field: 'scriptPath', message: 'Script path must end in .py.' })
      }
    } else {
      const moduleName = typeof options?.moduleName === 'string' ? options.moduleName.trim() : ''
      if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(moduleName)) {
        issues.push({ field: 'moduleName', message: 'Enter a valid qualified Python module name, such as package.module.' })
      }
    }
    const workingDirectory = typeof options?.workingDirectory === 'string' ? options.workingDirectory.trim() : ''
    if (workingDirectory && workingDirectory !== '.' && (workingDirectory.startsWith('/') || workingDirectory.split('/').some((part) => !part || part === '.' || part === '..'))) {
      issues.push({ field: 'workingDirectory', message: 'Working directory must be a project-relative directory, or empty for the project root.' })
    } else if (workingDirectory && workingDirectory !== '.') {
      const directory = files.find(workingDirectory)
      if (!directory || !directory.isDirectory) issues.push({ field: 'workingDirectory', message: `Working directory not found: ${workingDirectory}` })
    }
    if (typeof options?.arguments !== 'string') issues.push({ field: 'arguments', message: 'Program arguments must be text.' })
    else {
      try { parseCommandLineArguments(options.arguments) } catch (error) {
        issues.push({ field: 'arguments', message: error instanceof Error ? error.message : String(error) })
      }
    }
    if (options?.redirectInput === true) {
      const inputFile = typeof options.inputFile === 'string' ? options.inputFile.trim() : ''
      if (!inputFile || inputFile.startsWith('/') || inputFile.split('/').some((part) => !part || part === '.' || part === '..')) {
        issues.push({ field: 'inputFile', message: 'Input file must be a project-relative text file path.' })
      } else if (isEnvironmentFile(inputFile.split('/').at(-1) ?? '') || isLikelyBinaryFileName(inputFile)) {
        issues.push({ field: 'inputFile', message: 'This input file type is not available to the browser runtime.' })
      } else {
        const file = files.find(inputFile)
        if (!file || file.isDirectory) issues.push({ field: 'inputFile', message: `Input file not found: ${inputFile}` })
      }
    }
    return issues
  },
}

type WorkerRequest = { type: 'initialize' } | { type: 'run'; targetMode: 'script' | 'module'; scriptPath: string; moduleName: string; workingDirectory: string; redirectInput: boolean; inputFile: string; args: string[]; files: { path: string; content: string }[]; inputBuffer?: SharedArrayBuffer }
type WorkerEvent = { type: 'status'; status: 'starting' | 'running' | 'waiting-input'; message?: string } | { type: 'ready' } | { type: 'stdout' | 'stderr'; text: string } | { type: 'input-request'; requestId: string; prompt: string; available: boolean } | { type: 'finished'; exitCode: number } | { type: 'error'; message: string }

export class PyodidePythonExecutor implements RunExecutor<PythonRunOptions> {
  private worker?: Worker
  private readyPromise?: Promise<Worker>
  private activeRun?: { resolve: () => void; reject: (error: Error) => void; context: Parameters<RunExecutor<PythonRunOptions>['execute']>[1]; requestId: string; inputBuffer?: SharedArrayBuffer; releaseInput: { dispose(): void } }
  private active = false
  private runSequence = 0
  private disposed = false

  /** Warm the shared Python interpreter while the project is being opened. */
  preload(): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Python executor is disposed.'))
    return this.ensureWorker().then(() => undefined)
  }

  async execute(configuration: RunConfigurationRecord<PythonRunOptions>, context: Parameters<RunExecutor<PythonRunOptions>['execute']>[1]): Promise<void> {
    if (this.disposed) throw new Error('Python executor is disposed.')
    if (this.active) throw new Error('A Python process is already running.')
    const options = configuration.options
    const targetMode = options.targetMode === 'module' ? 'module' : 'script'
    if (targetMode === 'script') {
      const script = context.files.find(options.scriptPath ?? '')
      if (!script || script.isDirectory) throw new Error(`Python script not found: ${options.scriptPath ?? ''}`)
    }
    const args = parseCommandLineArguments(options.arguments ?? '')
    if (context.signal.aborted) return

    const runId = ++this.runSequence
    this.active = true
    const inputBuffer = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated ? new SharedArrayBuffer(16 + 1024 * 1024) : undefined
    let runTimer: ReturnType<typeof globalThis.setTimeout> | undefined
    const abort = () => {
      this.runSequence += 1
      this.active = false
      if (this.activeRun) this.cancelCurrentRun(true)
    }
    context.signal.addEventListener('abort', abort, { once: true })
    context.emit({ type: 'status', status: 'starting', message: 'Preparing Python project files…' })
    try {
      const filesPromise = collectProjectFiles(context.files.root, (count) => context.emit({ type: 'status', status: 'starting', message: `Preparing Python project files (${count} read)…` }))
      const [worker, files] = await Promise.all([this.ensureWorker(), filesPromise])
      if (context.signal.aborted) return
      if (targetMode === 'script' && !files.some((file) => file.path === options.scriptPath)) throw new Error(`Python script could not be read: ${options.scriptPath}`)

      await new Promise<void>((resolve, reject) => {
        const releaseInput = context.onInputResponse((replyId, value) => {
          const active = this.activeRun
          if (!active?.inputBuffer || replyId !== active.requestId) return
          const control = new Int32Array(active.inputBuffer, 0, 4)
          const bytes = new Uint8Array(active.inputBuffer, 16)
          if (value === null) Atomics.store(control, 0, 3)
          else {
            const encoded = new TextEncoder().encode(`${value}\n`)
            if (encoded.length > bytes.length) {
              context.emit({ type: 'stderr', text: 'Input line exceeds the 1 MiB limit and was rejected.\n' })
              Atomics.store(control, 0, 3)
            } else {
              bytes.set(encoded, 0)
              Atomics.store(control, 1, encoded.length)
              Atomics.store(control, 0, 1)
            }
          }
          Atomics.notify(control, 0)
          active.requestId = ''
        })
        this.activeRun = { resolve, reject, context, requestId: '', inputBuffer: options.redirectInput ? undefined : inputBuffer, releaseInput }
        runTimer = globalThis.setTimeout(() => this.failWorker(new Error('Python execution timed out after 90 seconds.')), 90_000)
        context.emit({ type: 'status', status: 'starting', message: 'Starting Python program…' })
        const request: WorkerRequest = {
          type: 'run', targetMode, scriptPath: options.scriptPath ?? '', moduleName: options.moduleName ?? '',
          workingDirectory: options.workingDirectory ?? '', redirectInput: options.redirectInput === true,
          inputFile: options.inputFile ?? '', args, files, inputBuffer: options.redirectInput ? undefined : inputBuffer,
        }
        worker.postMessage(request)
      })
    } finally {
      if (runTimer !== undefined) globalThis.clearTimeout(runTimer)
      context.signal.removeEventListener('abort', abort)
      if (this.runSequence === runId) this.active = false
    }
  }

  dispose(): void {
    this.disposed = true
    this.cancelCurrentRun(false)
    this.worker?.terminate()
    this.worker = undefined
    this.readyPromise = undefined
    this.active = false
  }

  private ensureWorker(): Promise<Worker> {
    if (this.disposed) return Promise.reject(new Error('Python executor is disposed.'))
    if (this.readyPromise) return this.readyPromise
    const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module', name: 'webbrains-pyodide' })
    this.worker = worker
    this.readyPromise = new Promise<Worker>((resolve, reject) => {
      let ready = false
      const failStartup = (error: Error) => {
        globalThis.clearTimeout(timer)
        if (!ready) reject(error)
        this.failWorker(error)
      }
      const timer = globalThis.setTimeout(() => failStartup(new Error('Python startup timed out after 90 seconds while loading Pyodide. Check network access.')), 90_000)
      worker.onerror = (event) => failStartup(new Error(event.message || 'Pyodide worker failed to load.'))
      worker.onmessageerror = () => failStartup(new Error('The browser could not decode a message from the Pyodide worker.'))
      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const message = event.data
        if (message.type === 'ready') {
          ready = true
          globalThis.clearTimeout(timer)
          resolve(worker)
          return
        }
        if (message.type === 'error') {
          failStartup(new Error(message.message))
          return
        }
        const active = this.activeRun
        if (!active) return
        if (message.type === 'stdout' || message.type === 'stderr' || message.type === 'status') active.context.emit(message)
        else if (message.type === 'input-request') {
          active.requestId = message.requestId
          active.context.emit({ ...message, available: message.available && Boolean(active.inputBuffer) })
        } else if (message.type === 'finished') {
          active.context.emit(message)
          this.completeCurrentRun(message.exitCode === 0 ? undefined : new Error(`Python exited with code ${message.exitCode}.`))
        }
      }
      worker.postMessage({ type: 'initialize' })
    }).catch((error: unknown) => {
      if (this.worker === worker) { worker.terminate(); this.worker = undefined; this.readyPromise = undefined }
      throw error
    })
    return this.readyPromise
  }

  private completeCurrentRun(error?: Error): void {
    const active = this.activeRun
    if (!active) return
    this.activeRun = undefined
    active.releaseInput.dispose()
    if (error) active.reject(error)
    else active.resolve()
  }

  private cancelCurrentRun(terminateWorker: boolean): void {
    if (this.activeRun) this.completeCurrentRun(new Error('Python process stopped.'))
    if (terminateWorker && this.worker) {
      this.worker.terminate()
      this.worker = undefined
      this.readyPromise = undefined
    }
  }

  private failWorker(error: Error): void {
    this.completeCurrentRun(error)
    if (this.worker) this.worker.terminate()
    this.worker = undefined
    this.readyPromise = undefined
  }
}

export async function collectProjectFiles(root: VirtualFile, onProgress?: (filesRead: number) => void): Promise<{ path: string; content: string }[]> {
  const result: { path: string; content: string }[] = []
  const visit = async (entry: VirtualFile, relativePath: string): Promise<void> => {
    if (entry.isDirectory) {
      const directory = entry as VirtualFile & { children(): readonly VirtualFile[] }
      for (const child of directory.children()) {
        if (isEnvironmentFile(child.name)) continue
        const path = relativePath ? `${relativePath}/${child.name}` : child.name
        if (path === '.run/webrains-run-configurations.json') continue
        await visit(child, path)
      }
    } else if (!isLikelyBinaryFileName(entry.name)) {
      result.push({ path: relativePath, content: await entry.readText() })
      onProgress?.(result.length)
    }
  }
  await visit(root, '')
  return result
}

function isEnvironmentFile(name: string): boolean {
  return name === '.env' || name.startsWith('.env.')
}
