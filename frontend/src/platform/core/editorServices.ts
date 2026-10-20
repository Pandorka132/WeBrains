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
}

export interface EditorCompletionContext {
  readonly languageId: string
  readonly source: string
  readonly caretOffset: number
  readonly prefix: string
  readonly signal: AbortSignal
}

/** Browser-side analogue of IntelliJ's `com.intellij.completion.contributor` extension point. */
export interface EditorCompletionContributor {
  readonly id: string
  readonly languageId: string
  contribute(context: EditorCompletionContext): Promise<readonly EditorCompletionItem[]> | readonly EditorCompletionItem[]
}

export class EditorCompletionContributorRegistry {
  private readonly contributors = new Map<string, EditorCompletionContributor>()

  register(contributor: EditorCompletionContributor): Disposable {
    const id = contributor.id.trim()
    const languageId = contributor.languageId.trim()
    if (!id || /\s/.test(id) || !languageId || /\s/.test(languageId)) {
      throw new Error('Completion contributor id and language id must be non-empty identifiers')
    }
    if (this.contributors.has(id)) throw new Error(`Completion contributor already registered: ${id}`)
    const snapshot = Object.freeze({ ...contributor, id, languageId })
    this.contributors.set(id, snapshot)
    return disposable(() => {
      if (this.contributors.get(id) === snapshot) this.contributors.delete(id)
    })
  }

  forLanguage(languageId: string): readonly EditorCompletionContributor[] {
    return [...this.contributors.values()].filter((contributor) => contributor.languageId === languageId)
  }
}

/** Collect lookup items exclusively from registered plugin contributors. */
export async function collectEditorCompletionItems(
  registry: EditorCompletionContributorRegistry,
  context: EditorCompletionContext,
): Promise<readonly EditorCompletionItem[]> {
  if (context.signal.aborted) return []
  const contributions = await Promise.all(
    registry.forLanguage(context.languageId).map((contributor) => contributor.contribute(context)),
  )
  return context.signal.aborted ? [] : contributions.flat()
}

/** Language metadata and analysis contributed by a statically bundled plugin. */
export interface EditorLanguageService {
  readonly id: string
  readonly fileExtensions: readonly string[]
  readonly tabSize: number
  /** Closing characters configured by the language's brace/quote handlers. */
  readonly autoClosingPairs?: readonly { readonly open: string; readonly close: string; readonly kind: 'brace' | 'quote' }[]
  diagnose?(source: string, signal: AbortSignal): Promise<readonly EditorDiagnostic[]>
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
