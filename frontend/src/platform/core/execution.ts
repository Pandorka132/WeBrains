import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'
import type { VirtualFileSystem } from './vfs.ts'

export type RunConfigurationRecord<T = unknown> = { id: string; typeId: string; name: string; options: T }
export type ValidationIssue = { field: string; message: string }
export type RunConfigurationField = { id: string; label: string; kind: 'text' | 'path' | 'multiline' | 'boolean' | 'choice'; placeholder?: string; choices?: readonly { value: string; label: string }[]; description?: string; visibleWhen?: { field: string; value: string } }
export type ExecutionStatus = 'starting' | 'running' | 'waiting-input' | 'completed' | 'failed' | 'stopped'
export type ExecutionEvent =
  | { type: 'status'; status: ExecutionStatus; message?: string }
  | { type: 'stdout' | 'stderr'; text: string }
  | { type: 'input-request'; requestId: string; prompt: string; available: boolean }
  | { type: 'finished'; exitCode: number }
  | { type: 'error'; message: string }

export interface RunExecutionContext {
  readonly files: VirtualFileSystem
  readonly projectName: string
  readonly baseUrl: string
  readonly emit: (event: ExecutionEvent) => void
  readonly signal: AbortSignal
  onInputResponse(handler: (requestId: string, value: string | null) => void): Disposable
}

export interface RunExecutor<T = unknown> {
  execute(configuration: RunConfigurationRecord<T>, context: RunExecutionContext): Promise<void>
  dispose?(): void
}

/** A plugin contribution that describes one user-configurable way to launch a program. */
export interface RunConfigurationType<T = unknown> {
  readonly id: string
  readonly pluginId: string
  readonly displayName: string
  readonly icon?: string
  readonly executorId: string
  readonly fields?: readonly RunConfigurationField[]
  createDefault(project: { name: string; activeFile?: string }): RunConfigurationRecord<T>
  validate(configuration: RunConfigurationRecord<T>, files: VirtualFileSystem): readonly ValidationIssue[] | Promise<readonly ValidationIssue[]>
}

export class RunConfigurationRegistry {
  private readonly types = new Map<string, RunConfigurationType>()
  private readonly executors = new Map<string, RunExecutor>()

  registerType<T>(type: RunConfigurationType<T>): Disposable {
    if (!type.id.trim() || !type.pluginId.trim() || !type.executorId.trim() || this.types.has(type.id)) {
      throw new Error(`Run configuration type already registered or invalid: ${type.id}`)
    }
    this.types.set(type.id, type as RunConfigurationType)
    return disposable(() => { if (this.types.get(type.id) === type) this.types.delete(type.id) })
  }

  registerExecutor<T>(id: string, executor: RunExecutor<T>): Disposable {
    if (!id.trim() || this.executors.has(id)) throw new Error(`Run executor already registered or invalid: ${id}`)
    this.executors.set(id, executor as RunExecutor)
    return disposable(() => {
      if (this.executors.get(id) !== executor) return
      this.executors.delete(id)
      executor.dispose?.()
    })
  }

  type(id: string): RunConfigurationType | undefined { return this.types.get(id) }
  executor(id: string): RunExecutor | undefined { return this.executors.get(id) }
  allTypes(): readonly RunConfigurationType[] { return [...this.types.values()] }
  canCreateConfiguration(typeId: string): boolean { return this.types.has(typeId) && Boolean(this.executors.get(this.types.get(typeId)!.executorId)) }
}

type ExecutionSession = {
  id: number
  controller: AbortController
  emit: (event: ExecutionEvent) => void
  inputHandlers: Set<(requestId: string, value: string | null) => void>
}

/** Owns one foreground process. Validation and executor events are guarded against stale sessions. */
export class ExecutionManager {
  private current?: ExecutionSession
  private sequence = 0
  private disposed = false
  private readonly registry: RunConfigurationRegistry

  constructor(registry: RunConfigurationRegistry) {
    this.registry = registry
  }

  async run(
    configuration: RunConfigurationRecord,
    files: VirtualFileSystem,
    projectName: string,
    baseUrl: string,
    emit: (event: ExecutionEvent) => void,
  ): Promise<void> {
    if (this.disposed) throw new Error('Execution manager is disposed')
    const id = ++this.sequence
    await this.stop()
    if (this.disposed || id !== this.sequence) return

    const type = this.registry.type(configuration.typeId)
    if (!type) {
      emit({ type: 'error', message: `Unknown run configuration type: ${configuration.typeId}` })
      emit({ type: 'status', status: 'failed' })
      return
    }
    let issues: readonly ValidationIssue[]
    try {
      issues = await type.validate(configuration, files)
    } catch (error) {
      if (id === this.sequence) {
        emit({ type: 'error', message: errorMessage(error) })
        emit({ type: 'status', status: 'failed' })
      }
      return
    }
    if (id !== this.sequence || this.disposed) return
    if (issues.length) {
      emit({ type: 'error', message: issues.map((issue) => issue.message).join('\n') })
      emit({ type: 'status', status: 'failed' })
      return
    }
    const executor = this.registry.executor(type.executorId)
    if (!executor) {
      emit({ type: 'error', message: `No executor registered for ${type.executorId}` })
      emit({ type: 'status', status: 'failed' })
      return
    }

    const controller = new AbortController()
    const session: ExecutionSession = { id, controller, emit, inputHandlers: new Set() }
    this.current = session
    const safeEmit = (event: ExecutionEvent) => { if (this.current === session && !controller.signal.aborted) emit(event) }
    safeEmit({ type: 'status', status: 'starting' })
    try {
      await executor.execute(configuration, {
        files, projectName, baseUrl, emit: safeEmit, signal: controller.signal,
        onInputResponse: (handler) => {
          if (controller.signal.aborted || this.current !== session) return disposable(() => undefined)
          session.inputHandlers.add(handler)
          return disposable(() => session.inputHandlers.delete(handler))
        },
      })
      if (this.current === session) safeEmit({ type: 'status', status: 'completed' })
    } catch (error) {
      if (this.current === session && !controller.signal.aborted) {
        safeEmit({ type: 'error', message: errorMessage(error) })
        safeEmit({ type: 'status', status: 'failed' })
      }
    } finally {
      if (this.current === session) this.current = undefined
    }
  }

  provideInput(requestId: string, value: string | null): void {
    for (const handler of this.current?.inputHandlers ?? []) handler(requestId, value)
  }

  async stop(): Promise<void> {
    const session = this.current
    if (!session) return
    this.current = undefined
    session.controller.abort()
    for (const handler of session.inputHandlers) handler('', null)
    session.inputHandlers.clear()
    session.emit({ type: 'status', status: 'stopped', message: 'Process stopped.' })
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.sequence += 1
    void this.stop()
  }
}

/** Project run configurations are ordinary project files and follow the VFS provider's persistence. */
export const RUN_CONFIGURATIONS_PATH = '.run/webrains-run-configurations.json'

export async function readRunConfigurations(files: VirtualFileSystem): Promise<RunConfigurationRecord[]> {
  const file = files.find(RUN_CONFIGURATIONS_PATH)
  if (!file || file.isDirectory) return []
  try {
    const parsed: unknown = JSON.parse(await file.readText())
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isConfigurationRecord)
  } catch { return [] }
}

export async function writeRunConfigurations(files: VirtualFileSystem, configurations: readonly RunConfigurationRecord[]): Promise<void> {
  const validated = configurations.filter(isConfigurationRecord)
  await files.writeText(RUN_CONFIGURATIONS_PATH, JSON.stringify(validated, null, 2))
}

/** Parse a command-line parameter field into argv without invoking an OS shell. */
export function parseCommandLineArguments(input: string): string[] {
  const args: string[] = []
  let token = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  let started = false
  for (const character of input) {
    if (escaped) { token += character; escaped = false; started = true; continue }
    if (character === '\\' && quote !== "'") { escaped = true; started = true; continue }
    if (quote) {
      if (character === quote) quote = ''
      else token += character
      started = true
      continue
    }
    if (character === '"' || character === "'") { quote = character; started = true; continue }
    if (/\s/.test(character)) {
      if (started) { args.push(token); token = ''; started = false }
      continue
    }
    token += character
    started = true
  }
  if (escaped) token += '\\'
  if (quote) throw new Error('Unclosed quote in program arguments.')
  if (started) args.push(token)
  return args
}

function isConfigurationRecord(value: unknown): value is RunConfigurationRecord {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<RunConfigurationRecord>
  return typeof entry.id === 'string' && typeof entry.typeId === 'string' && typeof entry.name === 'string' && 'options' in entry
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
