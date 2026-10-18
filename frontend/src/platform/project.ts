import { DisposableScope } from './lifecycle.ts'
import type { Disposable } from './lifecycle.ts'
import { ServiceContainer } from './services.ts'
import type { ServiceKey } from './services.ts'

export class PlatformModule implements Disposable {
  readonly services = new ServiceContainer()
  readonly lifetime = new DisposableScope()
  readonly name: string

  constructor(name: string) {
    this.name = name
    if (name.length === 0) throw new Error('Module name must not be empty')
  }

  dispose(): void {
    this.lifetime.dispose()
    this.services.dispose()
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
    this.id = id
    this.name = name
    if (!id || !name) throw new Error('Project id and name are required')
  }

  addModule(module: PlatformModule): void {
    this.assertActive()
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
    this.lifetime.dispose()
    this.services.dispose()
    this.modules.clear()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Project is disposed')
  }
}
