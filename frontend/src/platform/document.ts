import type { Disposable } from './lifecycle.ts'
import { DisposableScope, disposable } from './lifecycle.ts'

export interface TextRange {
  readonly startOffset: number
  readonly endOffset: number
}

export interface DocumentChange {
  readonly range: TextRange
  readonly oldText: string
  readonly newText: string
  readonly version: number
}

/** Mutable text with synchronous change notifications and monotonically increasing versions. */
export class DocumentModel implements Disposable {
  private value: string
  private readonly listeners = new Set<{ listener: (change: DocumentChange) => void }>()
  private readonly lifetime = new DisposableScope()
  private versionValue = 0
  private disposed = false

  constructor(text = '') {
    this.value = normalizeLineSeparators(text)
  }

  get text(): string {
    return this.value
  }

  get version(): number {
    return this.versionValue
  }

  get textLength(): number {
    return this.value.length
  }

  replace(range: TextRange, newText: string): DocumentChange {
    this.assertActive()
    assertRange(range, this.value.length)
    const oldText = this.value.slice(range.startOffset, range.endOffset)
    const normalizedText = normalizeLineSeparators(newText)
    this.value = `${this.value.slice(0, range.startOffset)}${normalizedText}${this.value.slice(range.endOffset)}`
    const change: DocumentChange = { range, oldText, newText: normalizedText, version: ++this.versionValue }
    for (const subscription of [...this.listeners]) {
      if (this.listeners.has(subscription)) subscription.listener(change)
    }
    return change
  }

  insert(offset: number, text: string): DocumentChange {
    return this.replace({ startOffset: offset, endOffset: offset }, text)
  }

  delete(range: TextRange): DocumentChange {
    return this.replace(range, '')
  }

  onChange(listener: (change: DocumentChange) => void, parent?: DisposableScope): Disposable {
    this.assertActive()
    const entry = { listener }
    this.listeners.add(entry)
    const subscription = disposable(() => this.listeners.delete(entry))
    this.lifetime.add(subscription)
    parent?.add(subscription)
    return subscription
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.lifetime.dispose()
    this.listeners.clear()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Document is disposed')
  }
}

function normalizeLineSeparators(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function assertRange(range: TextRange, length: number): void {
  if (!Number.isInteger(range.startOffset) || !Number.isInteger(range.endOffset)) {
    throw new RangeError('Document offsets must be integers')
  }
  if (range.startOffset < 0 || range.endOffset < range.startOffset || range.endOffset > length) {
    throw new RangeError(`Invalid document range ${range.startOffset}..${range.endOffset} for length ${length}`)
  }
}
