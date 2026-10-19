import { disposable } from './lifecycle.ts'
import type { Disposable } from './lifecycle.ts'

export interface EditorDiagnostic {
  readonly startOffset: number
  readonly endOffset: number
  readonly severity: 'error' | 'warning' | 'information'
  readonly message: string
  readonly source?: string
}

export interface EditorCompletionItem {
  readonly label: string
  readonly insertText?: string
  readonly detail?: string
  readonly kind?: 'keyword' | 'variable' | 'function' | 'class' | 'module' | 'text'
  readonly priority?: number
}

export interface EditorCompletionContext {
  readonly source: string
  readonly caretOffset: number
  readonly prefix: string
  readonly signal: AbortSignal
  readonly tokens?: readonly { readonly type: string; readonly start: number; readonly end: number; readonly text: string }[]
}

/** Language metadata and analysis contributed by a statically bundled plugin. */
export interface EditorLanguageService {
  readonly id: string
  readonly fileExtensions: readonly string[]
  readonly tabSize: number
  /** Closing characters configured by the language's brace/quote handlers. */
  readonly autoClosingPairs?: readonly { readonly open: string; readonly close: string; readonly kind: 'brace' | 'quote' }[]
  diagnose?(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]>
  complete?(context: EditorCompletionContext): Promise<readonly EditorCompletionItem[]>
}

export class EditorLanguageServiceRegistry {
  private readonly services = new Map<string, EditorLanguageService>()

  register(service: EditorLanguageService): Disposable {
    const id = service.id.trim()
    const extensions = [...new Set(service.fileExtensions.map((value) => value.trim().replace(/^\.+/, '').toLowerCase()))]
    if (!id || /\s/.test(id) || extensions.length === 0 || extensions.some((extension) => !/^[a-z0-9][a-z0-9._+-]*$/.test(extension))) {
      throw new Error(`Invalid editor language service: ${service.id}`)
    }
    if (!Number.isInteger(service.tabSize) || service.tabSize < 1 || service.tabSize > 16) throw new Error(`Invalid tab size for ${id}`)
    if (this.services.has(id)) throw new Error(`Editor language service already registered: ${id}`)
    const conflict = [...this.services.values()].find((registered) => registered.fileExtensions.some((extension) => extensions.includes(extension)))
    if (conflict) throw new Error(`File extension already registered by editor service ${conflict.id}`)
    const snapshot = Object.freeze({ ...service, id, fileExtensions: Object.freeze(extensions) })
    this.services.set(id, snapshot)
    return disposable(() => { if (this.services.get(id) === snapshot) this.services.delete(id) })
  }

  find(id: string): EditorLanguageService | undefined { return this.services.get(id) }

  forFileName(fileName: string): EditorLanguageService | undefined {
    const separator = fileName.lastIndexOf('.')
    if (separator < 0 || separator === fileName.length - 1) return undefined
    const extension = fileName.slice(separator + 1).toLowerCase()
    return [...this.services.values()].find((service) => service.fileExtensions.includes(extension))
  }
}
