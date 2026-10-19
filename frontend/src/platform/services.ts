import type { Disposable } from './lifecycle.ts'
import { DisposableScope } from './lifecycle.ts'

export type ServiceKey<T> = symbol & { readonly __serviceType?: T }

export function serviceKey<T>(name: string): ServiceKey<T> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Service key name must not be empty')
  return Symbol(cleanName) as ServiceKey<T>
}

/** A small scoped singleton registry; service lifetime follows its container. */
export class ServiceContainer implements Disposable {
  private readonly services = new Map<symbol, unknown>()
  private readonly lifetime = new DisposableScope()

  register<T>(key: ServiceKey<T>, service: T): T {
    if (this.lifetime.isDisposed) throw new Error('Service container is disposed')
    if (this.services.has(key)) throw new Error(`Service already registered: ${key.description ?? 'unknown'}`)
    this.services.set(key, service)
    if (isDisposable(service)) this.lifetime.add(service)
    return service
  }

  get<T>(key: ServiceKey<T>): T {
    if (!this.services.has(key)) throw new Error(`Service not registered: ${key.description ?? 'unknown'}`)
    return this.services.get(key) as T
  }

  find<T>(key: ServiceKey<T>): T | undefined {
    return this.services.get(key) as T | undefined
  }

  dispose(): void {
    this.services.clear()
    this.lifetime.dispose()
  }
}

function isDisposable(value: unknown): value is Disposable {
  return typeof value === 'object' && value !== null && 'dispose' in value && typeof value.dispose === 'function'
}
