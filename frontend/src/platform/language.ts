import type { TextRange } from './document.ts'
import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'

export interface ElementType {
  readonly languageId: string
  readonly debugName: string
}

export interface Token extends TextRange {
  readonly type: ElementType
  readonly text: string
}

export interface Lexer {
  start(text: string, startOffset?: number, endOffset?: number): void
  nextToken(): Token | undefined
}

export interface PsiElement {
  readonly elementType: ElementType
  readonly textRange: TextRange
  readonly text: string
  readonly parent?: PsiElement
  children(): readonly PsiElement[]
}

/** Describes a language implementation boundary; parsers and lexers are supplied by plugins. */
export interface LanguageDefinition {
  readonly id: string
  readonly displayName: string
  readonly fileExtensions: readonly string[]
  readonly lexer?: (text: string) => Lexer
}

export class LanguageRegistry {
  private readonly languages = new Map<string, LanguageDefinition>()

  register(language: LanguageDefinition): Disposable {
    const id = language.id.trim()
    const displayName = language.displayName.trim()
    const normalizedExtensions = language.fileExtensions.map(normalizeExtension)
    const extensions = [...new Set(normalizedExtensions)]
    if (!id || !displayName || extensions.length === 0 || extensions.some((extension) => !/^[a-z0-9][a-z0-9._+-]*$/.test(extension)) || this.languages.has(id)) {
      throw new Error(`Language already registered or invalid: ${language.id}`)
    }
    const conflictingLanguage = [...this.languages.values()].find((registered) => registered.fileExtensions.some((extension) => extensions.includes(extension)))
    if (conflictingLanguage) throw new Error(`File extension already registered by ${conflictingLanguage.id}`)
    const snapshot: LanguageDefinition = Object.freeze({
      ...language,
      id,
      displayName,
      fileExtensions: Object.freeze(extensions),
    })
    this.languages.set(id, snapshot)
    return disposable(() => {
      if (this.languages.get(id) === snapshot) this.languages.delete(id)
    })
  }

  find(id: string): LanguageDefinition | undefined {
    return this.languages.get(id)
  }

  forFileName(fileName: string): LanguageDefinition | undefined {
    const separator = fileName.lastIndexOf('.')
    if (separator < 0 || separator === fileName.length - 1) return undefined
    const extension = normalizeExtension(fileName.slice(separator + 1))
    if (!extension) return undefined
    return [...this.languages.values()].find((language) => language.fileExtensions.includes(extension))
  }
}

function normalizeExtension(extension: string): string {
  return extension.trim().replace(/^\.+/, '').toLowerCase()
}

export function elementType(languageId: string, debugName: string): ElementType {
  return { languageId, debugName }
}
