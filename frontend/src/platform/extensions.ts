import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'

export interface ExtensionPoint<T> {
  readonly name: string
  readonly id: symbol
  readonly __extensionType?: T
}

export function extensionPoint<T>(name: string): ExtensionPoint<T> {
  return { name, id: Symbol(name) }
}

/** In-memory extension registration. It does not parse or execute IntelliJ descriptors. */
export class ExtensionRegistry {
  private readonly entries = new Map<symbol, Map<string, unknown>>()

  register<T>(point: ExtensionPoint<T>, id: string, extension: T): Disposable {
    if (id.length === 0) throw new Error('Extension id must not be empty')
    const values = this.entries.get(point.id) ?? new Map<string, unknown>()
    if (values.has(id)) throw new Error(`Extension already registered: ${point.name}/${id}`)
    values.set(id, extension)
    this.entries.set(point.id, values)
    return disposable(() => {
      values.delete(id)
      if (values.size === 0) this.entries.delete(point.id)
    })
  }

  get<T>(point: ExtensionPoint<T>): readonly T[] {
    return [...(this.entries.get(point.id)?.values() ?? [])] as T[]
  }

  find<T>(point: ExtensionPoint<T>, id: string): T | undefined {
    return this.entries.get(point.id)?.get(id) as T | undefined
  }
}
