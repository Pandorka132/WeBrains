import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'

export interface ExtensionPoint<T> {
  readonly name: string
  readonly id: symbol
  readonly __extensionType?: T
}

export function extensionPoint<T>(name: string): ExtensionPoint<T> {
  const cleanName = name.trim()
  if (!cleanName) throw new Error('Extension point name must not be empty')
  return { name: cleanName, id: Symbol(cleanName) }
}

/** In-memory extension registration. It does not parse or execute IntelliJ descriptors. */
export class ExtensionRegistry {
  private readonly entries = new Map<symbol, Map<string, unknown>>()

  register<T>(point: ExtensionPoint<T>, id: string, extension: T): Disposable {
    const cleanId = id.trim()
    if (!cleanId || /\s/.test(cleanId)) throw new Error('Extension id must be a non-empty token')
    const values = this.entries.get(point.id) ?? new Map<string, unknown>()
    if (values.has(cleanId)) throw new Error(`Extension already registered: ${point.name}/${cleanId}`)
    values.set(cleanId, extension)
    this.entries.set(point.id, values)
    return disposable(() => {
      if (values.get(cleanId) === extension) values.delete(cleanId)
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
