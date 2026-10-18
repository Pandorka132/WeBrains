import type { TextRange } from './document.ts'

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

  register(language: LanguageDefinition): void {
    if (!language.id || this.languages.has(language.id)) throw new Error(`Language already registered or invalid: ${language.id}`)
    this.languages.set(language.id, language)
  }

  find(id: string): LanguageDefinition | undefined {
    return this.languages.get(id)
  }

  forFileName(fileName: string): LanguageDefinition | undefined {
    const extension = fileName.split('.').at(-1)?.toLowerCase()
    if (!extension) return undefined
    return [...this.languages.values()].find((language) =>
      language.fileExtensions.some((candidate) => candidate.toLowerCase() === extension),
    )
  }
}

export function elementType(languageId: string, debugName: string): ElementType {
  return { languageId, debugName }
}
