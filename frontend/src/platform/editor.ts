import type { DocumentModel, TextRange } from './document.ts'

export interface EditorSelection extends TextRange {}

export class EditorModel {
  private caretOffsetValue = 0
  private selectionValue: EditorSelection | undefined
  readonly document: DocumentModel

  constructor(document: DocumentModel) {
    this.document = document
  }

  get caretOffset(): number {
    return this.caretOffsetValue
  }

  setCaretOffset(offset: number): void {
    this.assertOffset(offset)
    this.caretOffsetValue = offset
    if (this.selectionValue && (offset < this.selectionValue.startOffset || offset > this.selectionValue.endOffset)) {
      this.selectionValue = undefined
    }
  }

  get selection(): EditorSelection | undefined {
    return this.selectionValue && { ...this.selectionValue }
  }

  setSelection(selection: EditorSelection | undefined): void {
    if (selection) {
      this.assertOffset(selection.startOffset)
      this.assertOffset(selection.endOffset)
      if (selection.endOffset < selection.startOffset) throw new RangeError('Selection end precedes its start')
      this.selectionValue = { ...selection }
      this.caretOffsetValue = selection.endOffset
    } else {
      this.selectionValue = undefined
    }
  }

  get selectedText(): string | undefined {
    const selection = this.selectionValue
    return selection ? this.document.text.slice(selection.startOffset, selection.endOffset) : undefined
  }

  private assertOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.document.textLength) {
      throw new RangeError(`Invalid editor offset: ${offset}`)
    }
  }
}
