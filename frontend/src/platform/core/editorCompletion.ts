import type { EditorCompletionItem } from './editorServices.ts'

export interface EditorCompletionEdit {
  readonly range: { readonly startOffset: number; readonly endOffset: number }
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}

/** Resolve the platform insertion range for a selected lookup item. */
export function resolveCompletionEdit(
  source: string,
  caretOffset: number,
  prefix: string,
  item: EditorCompletionItem,
  acceptWithTab = false,
): EditorCompletionEdit {
  const safeCaret = Math.max(0, Math.min(caretOffset, source.length))
  const actualPrefix = source.slice(Math.max(0, safeCaret - prefix.length), safeCaret) === prefix ? prefix : ''
  const startOffset = safeCaret - actualPrefix.length
  // IntelliJ's CompletionContributor documentation specifies that Tab removes the
  // identifier the caret is inside before inserting the selected lookup string.
  const suffix = acceptWithTab ? source.slice(safeCaret).match(/^[A-Za-z_]\w*/)?.[0] ?? '' : ''
  const endOffset = safeCaret + suffix.length
  const text = item.insertText ?? item.label
  const selection = startOffset + text.length
  return {
    range: { startOffset, endOffset },
    text,
    selectionStart: selection,
    selectionEnd: selection,
  }
}
