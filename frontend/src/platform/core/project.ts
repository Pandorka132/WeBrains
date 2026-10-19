import { DisposableScope } from './lifecycle.ts'
import type { Disposable } from './lifecycle.ts'
import { ServiceContainer } from './services.ts'
import type { ServiceKey } from './services.ts'

export class PlatformModule implements Disposable {
  readonly services = new ServiceContainer()
  readonly lifetime = new DisposableScope()
  readonly name: string

  constructor(name: string) {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Module name must not be empty')
    this.name = cleanName
  }

  dispose(): void {
    const errors: unknown[] = []
    try { this.lifetime.dispose() } catch (error) { errors.push(error) }
    try { this.services.dispose() } catch (error) { errors.push(error) }
    if (errors.length) throw new AggregateError(errors, `Errors while disposing module ${this.name}`)
  }
}

export class PlatformProject implements Disposable {
  readonly services = new ServiceContainer()
  readonly id: string
  readonly name: string
  private readonly modules = new Map<string, PlatformModule>()
  private readonly lifetime = new DisposableScope()
  private disposed = false

  constructor(id: string, name: string) {
    const cleanId = id.trim()
    const cleanName = name.trim()
    if (!cleanId || !cleanName) throw new Error('Project id and name are required')
    this.id = cleanId
    this.name = cleanName
  }

  addModule(module: PlatformModule): void {
    this.assertActive()
    if (module.lifetime.isDisposed) throw new Error(`Module is already disposed: ${module.name}`)
    if (this.modules.has(module.name)) throw new Error(`Module already exists: ${module.name}`)
    this.modules.set(module.name, module)
    this.lifetime.add(module)
  }

  getModules(): readonly PlatformModule[] {
    return [...this.modules.values()]
  }

  findModule(name: string): PlatformModule | undefined {
    return this.modules.get(name)
  }

  getService<T>(key: ServiceKey<T>): T {
    this.assertActive()
    return this.services.get(key)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    try { this.lifetime.dispose() } catch (error) { errors.push(error) }
    try { this.services.dispose() } catch (error) { errors.push(error) }
    this.modules.clear()
    if (errors.length) throw new AggregateError(errors, `Errors while disposing project ${this.name}`)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Project is disposed')
  }
}
