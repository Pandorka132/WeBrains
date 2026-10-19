import { disposable } from './lifecycle.ts'
import type { Disposable } from './lifecycle.ts'
import type { TextRange } from './document.ts'

export type EditorKey = 'Enter' | 'Tab'

export interface EditorKeyContext {
  readonly key: EditorKey
  readonly filePath: string
  readonly source: string
  readonly caretOffset: number
  readonly selection: TextRange
  readonly shiftKey: boolean
  readonly indentSize: number
}

export interface EditorTextEdit {
  readonly range: TextRange
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

export interface EditorKeyHandler {
  readonly id: string
  readonly keys: readonly EditorKey[]
  readonly priority?: number
  handle(context: EditorKeyContext): EditorTextEdit | undefined
}

/** Ordered platform dispatch for language-contributed smart keys and editor defaults. */
export class EditorKeyHandlerRegistry {
  private readonly handlers = new Map<string, { handler: EditorKeyHandler; order: number }>()
  private nextOrder = 0

  register(handler: EditorKeyHandler): Disposable {
    const id = handler.id.trim()
    const keys = [...new Set(handler.keys)]
    if (!id || /\s/.test(id) || keys.length === 0 || keys.some((key) => key !== 'Enter' && key !== 'Tab')) {
      throw new Error(`Invalid editor key handler: ${handler.id}`)
    }
    if (!Number.isFinite(handler.priority ?? 0)) throw new Error(`Invalid priority for editor key handler ${id}`)
    if (this.handlers.has(id)) throw new Error(`Editor key handler already registered: ${id}`)
    const snapshot: EditorKeyHandler = Object.freeze({ ...handler, id, keys: Object.freeze(keys) })
    const registration = { handler: snapshot, order: this.nextOrder++ }
    this.handlers.set(id, registration)
    return disposable(() => {
      if (this.handlers.get(id) === registration) this.handlers.delete(id)
    })
  }

  dispatch(context: EditorKeyContext): EditorTextEdit {
    if (!Number.isInteger(context.caretOffset) || context.caretOffset < 0 || context.caretOffset > context.source.length) {
      throw new RangeError(`Invalid caret offset: ${context.caretOffset}`)
    }
    if (!Number.isInteger(context.selection.startOffset) || !Number.isInteger(context.selection.endOffset)
      || context.selection.startOffset < 0 || context.selection.endOffset < context.selection.startOffset
      || context.selection.endOffset > context.source.length) {
      throw new RangeError('Invalid editor selection')
    }
    if (!Number.isInteger(context.indentSize) || context.indentSize < 1 || context.indentSize > 16) {
      throw new RangeError(`Invalid editor indent size: ${context.indentSize}`)
    }
    const handlers = [...this.handlers.values()]
      .filter(({ handler }) => handler.keys.includes(context.key))
      .sort((left, right) => (right.handler.priority ?? 0) - (left.handler.priority ?? 0) || left.order - right.order)
    for (const { handler } of handlers) {
      const edit = handler.handle(context)
      if (edit) return validateEdit(edit, context.source.length)
    }
    return context.key === 'Enter' ? defaultEnter(context) : defaultTab(context)
  }
}

function defaultEnter(context: EditorKeyContext): EditorTextEdit {
  const lineStart = context.source.lastIndexOf('\n', Math.max(0, context.caretOffset - 1)) + 1
  const beforeCaret = context.source.slice(lineStart, context.caretOffset)
  const indentation = beforeCaret.match(/^[\t ]*/)?.[0] ?? ''
  const text = `\n${indentation}`
  const caret = context.selection.startOffset + text.length
  return { range: context.selection, text, selectionStart: caret, selectionEnd: caret }
}

function defaultTab(context: EditorKeyContext): EditorTextEdit {
  const indent = ' '.repeat(context.indentSize)
  const { source, selection } = context
  if (context.shiftKey) return unindentLines(context, indent.length)
  if (selection.startOffset === selection.endOffset) {
    const caret = context.caretOffset + indent.length
    return { range: selection, text: indent, selectionStart: caret, selectionEnd: caret }
  }
  const lineStart = source.lastIndexOf('\n', Math.max(0, selection.startOffset - 1)) + 1
  const selectionLineEnd = source.indexOf('\n', selection.endOffset)
  const lineEnd = selectionLineEnd < 0 ? source.length : selectionLineEnd
  const range = { startOffset: lineStart, endOffset: lineEnd }
  const selectedLines = source.slice(lineStart, lineEnd).split('\n')
  const replacement = selectedLines.map((line) => `${indent}${line}`).join('\n')
  const firstLineOffset = selection.startOffset - lineStart
  const start = lineStart + indent.length + firstLineOffset
  const end = selection.endOffset + indent.length * selectedLines.length
  return { range, text: replacement, selectionStart: start, selectionEnd: Math.min(end, lineStart + replacement.length) }
}

function unindentLines(context: EditorKeyContext, indentSize: number): EditorTextEdit {
  const { source, selection } = context
  const lineStart = source.lastIndexOf('\n', Math.max(0, selection.startOffset - 1)) + 1
  const selectionLineEnd = source.indexOf('\n', selection.endOffset)
  const lineEnd = selectionLineEnd < 0 ? source.length : selectionLineEnd
  const range = { startOffset: lineStart, endOffset: lineEnd }
  const original = source.slice(lineStart, lineEnd)
  const lines = original.split('\n')
  const removedByLine = lines.map((line) => Math.min(indentSize, line.match(/^ */)?.[0].length ?? 0))
  const replacement = lines.map((line, index) => line.slice(removedByLine[index])).join('\n')

  const mapOffset = (originalOffset: number): number => {
    let mappedOffset = originalOffset
    let originalLineStart = lineStart
    for (let index = 0; index < lines.length; index += 1) {
      const removed = removedByLine[index]
      if (originalOffset >= originalLineStart + removed) mappedOffset -= removed
      else if (originalOffset > originalLineStart) {
        mappedOffset = originalLineStart - removedByLine.slice(0, index).reduce((sum, amount) => sum + amount, 0)
        break
      } else {
        break
      }
      originalLineStart += lines[index].length + 1
    }
    return mappedOffset
  }

  const selectionStart = mapOffset(selection.startOffset)
  const selectionEnd = Math.max(selectionStart, mapOffset(selection.endOffset))
  return { range, text: replacement, selectionStart, selectionEnd }
}

function validateEdit(edit: EditorTextEdit, sourceLength: number): EditorTextEdit {
  const resultingLength = sourceLength - (edit.range.endOffset - edit.range.startOffset) + edit.text.length
  if (!Number.isInteger(edit.range.startOffset) || !Number.isInteger(edit.range.endOffset)
    || edit.range.startOffset < 0 || edit.range.endOffset < edit.range.startOffset || edit.range.endOffset > sourceLength
    || !Number.isInteger(edit.selectionStart) || !Number.isInteger(edit.selectionEnd)
    || edit.selectionStart < 0 || edit.selectionEnd < edit.selectionStart || edit.selectionEnd > resultingLength) {
    throw new RangeError('Editor key handler returned an invalid edit')
  }
  return edit
}
