import type { DocumentChange, DocumentModel, TextRange } from './document.ts'
import type { Disposable } from './lifecycle.ts'

export interface EditorSelection extends TextRange {}

export class EditorModel implements Disposable {
  private caretOffsetValue = 0
  private selectionValue: EditorSelection | undefined
  private readonly documentSubscription: Disposable
  readonly document: DocumentModel

  constructor(document: DocumentModel) {
    this.document = document
    this.documentSubscription = document.onChange((change) => this.adjustOffsets(change))
  }

  dispose(): void {
    this.documentSubscription.dispose()
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

  private adjustOffsets(change: DocumentChange): void {
    const { startOffset, endOffset } = change.range
    const removedLength = endOffset - startOffset
    const insertedLength = change.newText.length
    const mapOffset = (offset: number): number => {
      if (offset < startOffset) return offset
      if (offset > endOffset) return offset + insertedLength - removedLength
      return startOffset + insertedLength
    }

    this.caretOffsetValue = mapOffset(this.caretOffsetValue)
    if (this.selectionValue) {
      this.selectionValue = {
        startOffset: mapOffset(this.selectionValue.startOffset),
        endOffset: mapOffset(this.selectionValue.endOffset),
      }
      if (this.selectionValue.endOffset < this.selectionValue.startOffset) this.selectionValue = undefined
    }
  }

  private assertOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.document.textLength) {
      throw new RangeError(`Invalid editor offset: ${offset}`)
    }
  }
}
