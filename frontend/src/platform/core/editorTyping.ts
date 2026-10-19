import type { TextRange } from './document.ts'

export interface EditorAutoClosingPair {
  readonly open: string
  readonly close: string
  readonly kind: 'brace' | 'quote'
}

export interface EditorTypedCharacterEdit {
  readonly range: TextRange
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly skipExistingCloser?: boolean
}

/** Generic editor mechanics; language plugins only contribute their pair definitions. */
export function resolveAutoClosingPair(
  source: string,
  selection: TextRange,
  character: string,
  pairs: readonly EditorAutoClosingPair[],
): EditorTypedCharacterEdit | undefined {
  if (character.length !== 1 || selection.startOffset < 0 || selection.endOffset < selection.startOffset || selection.endOffset > source.length) return undefined
  const closer = pairs.find(({ close }) => close === character)
  if (closer && selection.startOffset === selection.endOffset && source[selection.startOffset] === character) {
    return { range: selection, text: '', selectionStart: selection.startOffset + 1, selectionEnd: selection.startOffset + 1, skipExistingCloser: true }
  }
  const pair = pairs.find(({ open }) => open === character)
  if (!pair) return undefined
  if (pair.kind === 'quote') {
    let escapes = 0
    for (let offset = selection.startOffset - 1; offset >= 0 && source[offset] === '\\'; offset -= 1) escapes += 1
    if (escapes % 2 === 1) return undefined
  }
  const selectedText = source.slice(selection.startOffset, selection.endOffset)
  const text = `${character}${selectedText}${pair.close}`
  const caret = selection.startOffset + 1 + selectedText.length
  return { range: selection, text, selectionStart: caret, selectionEnd: caret }
}
