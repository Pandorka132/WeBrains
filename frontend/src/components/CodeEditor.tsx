import { useEffect, useRef, useState } from 'react'
import { editorKeyHandlers, editorLanguageServices } from '../platform/plugin-system/builtinPlugins.ts'
import type { EditorCompletionItem, EditorDiagnostic } from '../platform/core/editorServices.ts'
import { resolveAutoClosingPair } from '../platform/core/editorTyping.ts'

interface CodeEditorProps {
  filePath: string
  value: string
  onChange(value: string): void
  onCaretChange?(offset: number): void
}

const tokenPattern = /(?:\/\/.*|\b(?:import|from|export|function|const|let|return|if|throw|new|class|async|await|default|interface|type)\b|\b(?:true|false|null|undefined)\b|\b\d+\b|(['"`])(?:\\.|(?!\1)[^\\])*?\1|=>)/g
const pythonTokenPattern = /(?:#.*|\b(?:def|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|class|try|except|finally|with|pass|break|continue|lambda|yield|async|await|raise|assert|global|nonlocal|del|match|case)\b|\b(?:True|False|None)\b|\b\d+\b|(['"])(?:\\.|(?!\1)[^\\])*?\1)/g

interface PythonLexerToken {
  type: string
  start: number
  end: number
  text: string
}

interface PythonLexerResult {
  source: string
  tokens: PythonLexerToken[]
}

let pythonWasmModulePromise: Promise<WebAssembly.Module> | null = null

function loadPythonWasmModule(): Promise<WebAssembly.Module> {
  if (!pythonWasmModulePromise) {
    const wasmUrl = `${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-lexer.js.wasm`
    pythonWasmModulePromise = fetch(wasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load Python lexer WASM: HTTP ${response.status}`)
        return response.arrayBuffer()
      })
      .then((bytes) => WebAssembly.compile(bytes))
      .catch((error) => {
        pythonWasmModulePromise = null
        throw error
      })
  }
  return pythonWasmModulePromise
}

function pythonTokenClass(type: string): string | undefined {
  if (/COMMENT/.test(type)) return 'comment'
  if (/STRING|FSTRING|BYTES/.test(type)) return 'string'
  if (/NUMBER|INTEGER|FLOAT/.test(type)) return 'number'
  if (/TRUE|FALSE|NONE|BOOLEAN/.test(type)) return 'literal'
  if (/KEYWORD/.test(type)) return 'keyword'
  return undefined
}

function highlightPythonLine(line: string, lineStartOffset: number, tokens: readonly PythonLexerToken[], diagnostics: readonly EditorDiagnostic[]) {
  const lineEndOffset = lineStartOffset + line.length
  const boundaries = new Set<number>([0, line.length])
  for (const token of tokens) {
    if (token.end <= lineStartOffset || token.start >= lineEndOffset) continue
    boundaries.add(Math.max(token.start, lineStartOffset) - lineStartOffset)
    boundaries.add(Math.min(token.end, lineEndOffset) - lineStartOffset)
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.endOffset <= lineStartOffset || diagnostic.startOffset >= lineEndOffset) continue
    boundaries.add(Math.max(diagnostic.startOffset, lineStartOffset) - lineStartOffset)
    boundaries.add(Math.min(diagnostic.endOffset, lineEndOffset) - lineStartOffset)
  }
  const positions = [...boundaries].sort((a, b) => a - b)
  const result: React.ReactNode[] = []
  for (let index = 0; index < positions.length - 1; index += 1) {
    const start = positions[index]
    const end = positions[index + 1]
    if (end <= start) continue
    const absoluteStart = lineStartOffset + start
    const absoluteEnd = lineStartOffset + end
    const text = line.slice(start, end)
    const token = tokens.find((candidate) => candidate.start <= absoluteStart && candidate.end >= absoluteEnd)
    const diagnostic = diagnostics.find((candidate) => candidate.startOffset < absoluteEnd && candidate.endOffset > absoluteStart)
    const tokenClass = pythonTokenClass(token?.type ?? '')
    const lexicalError = /BAD_CHARACTER|INCONSISTENT_DEDENT/.test(token?.type ?? '')
    const classes = [tokenClass ? `tok-${tokenClass}` : '', diagnostic ? `diagnostic-${diagnostic.severity}` : lexicalError ? 'diagnostic-error' : ''].filter(Boolean)
    const title = diagnostic?.message ?? (lexicalError ? 'Invalid Python token' : undefined)
    result.push(classes.length
      ? <span className={classes.join(' ')} key={`${start}-${end}`} title={title}>{text}</span>
      : text)
  }
  return result.length ? result : ' '
}

function highlightLine(line: string, isPython: boolean, pythonTokens?: readonly PythonLexerToken[], lineStartOffset = 0, diagnostics: readonly EditorDiagnostic[] = []) {
  if (isPython && pythonTokens) return highlightPythonLine(line, lineStartOffset, pythonTokens, diagnostics)
  const result: React.ReactNode[] = []
  let cursor = 0
  const pattern = isPython ? pythonTokenPattern : tokenPattern
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) result.push(line.slice(cursor, index))
    const token = match[0]
    const kind = token.startsWith('//') || (isPython && token.startsWith('#')) ? 'comment' : /^['"`]/.test(token) ? 'string' : /^\d/.test(token) ? 'number' : token === '=>' ? 'operator' : /^(true|false|null|undefined|True|False|None)$/.test(token) ? 'literal' : 'keyword'
    result.push(<span className={`tok-${kind}`} key={`${index}-${token}`}>{token}</span>)
    cursor = index + token.length
  }
  if (cursor < line.length) result.push(line.slice(cursor))
  return result.length ? result : ' '
}

export function CodeEditor({ filePath, value, onChange, onCaretChange }: CodeEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const nextRequestId = useRef(0)
  const latestRequestId = useRef(0)
  const [pythonLexResult, setPythonLexResult] = useState<PythonLexerResult | null>(null)
  const [languageDiagnostics, setLanguageDiagnostics] = useState<{ source: string; languageId: string; items: readonly EditorDiagnostic[] } | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [caretLine, setCaretLine] = useState(0)
  const [caretOffset, setCaretOffset] = useState(0)
  const [completionRequested, setCompletionRequested] = useState(false)
  const [completionItems, setCompletionItems] = useState<readonly EditorCompletionItem[]>([])
  const [completionIndex, setCompletionIndex] = useState(0)
  const [completionPosition, setCompletionPosition] = useState({ left: 70, top: 30 })
  const lines = value.split('\n')
  const lineOffsets: number[] = []
  let currentOffset = 0
  for (const line of lines) {
    lineOffsets.push(currentOffset)
    currentOffset += line.length + 1
  }
  const isPython = filePath.endsWith('.py') || filePath.endsWith('.pyi')
  const editorLanguageService = editorLanguageServices.forFileName(filePath)
  const activePythonTokens = isPython && pythonLexResult?.source === value ? pythonLexResult.tokens : undefined
  const activeLanguageDiagnostics = languageDiagnostics?.source === value && languageDiagnostics.languageId === editorLanguageService?.id ? languageDiagnostics.items : []
  const lexicalDiagnostics: readonly EditorDiagnostic[] = (activePythonTokens ?? []).flatMap((token) => {
    if (!/BAD_CHARACTER|INCONSISTENT_DEDENT/.test(token.type)) return []
    return [{ startOffset: token.start, endOffset: token.end, severity: 'error' as const, message: /INCONSISTENT_DEDENT/.test(token.type) ? 'Inconsistent indentation' : `Invalid Python token: ${token.text}`, source: 'Python CE lexer' }]
  })
  const activeDiagnostics = [...activeLanguageDiagnostics, ...lexicalDiagnostics]
  const completionPrefix = value.slice(0, caretOffset).match(/[A-Za-z_]\w*$/)?.[0] ?? ''

  useEffect(() => {
    if (!isPython) return
    const requestId = ++nextRequestId.current
    latestRequestId.current = requestId
    let worker: Worker | null = null
    let cancelled = false
    const debounce = window.setTimeout(() => {
      void loadPythonWasmModule().then((wasmModule) => {
        if (cancelled || requestId !== latestRequestId.current) return
        worker = new Worker(`${import.meta.env.BASE_URL}plugins/pythoncore/python-ce-lexer.worker.js`, { name: 'python-ce-lexer' })
        worker.onmessage = (event: MessageEvent<{ type?: string; requestId?: number | null; tokens?: PythonLexerToken[]; message?: string }>) => {
          const message = event.data
          if (message.requestId !== requestId || requestId !== latestRequestId.current) return
          if (message.type === 'tokens' && message.tokens) {
            setPythonLexResult({ source: value, tokens: message.tokens })
            worker?.terminate()
            worker = null
          } else if (message.type === 'error') {
            worker?.terminate()
            worker = null
          }
        }
        worker.onerror = () => {
          worker?.terminate()
          worker = null
        }
        worker.postMessage({ type: 'tokenize', requestId, source: value, wasmModule })
      }).catch((error: unknown) => {
        if (!cancelled) console.error('Python CE lexer could not initialize:', error)
      })
    }, 100)
    return () => {
      cancelled = true
      window.clearTimeout(debounce)
      worker?.terminate()
    }
  }, [isPython, value])

  useEffect(() => {
    if (!completionRequested || !editorLanguageService?.complete || !completionPrefix) return
    const prefix = completionPrefix
    const controller = new AbortController()
    const debounce = window.setTimeout(() => {
      void editorLanguageService.complete!({ source: value, caretOffset, prefix, signal: controller.signal, tokens: activePythonTokens })
        .then((items) => {
          if (controller.signal.aborted) return
          setCompletionItems(items)
          setCompletionIndex(0)
          const beforeCaret = value.slice(0, caretOffset)
          const line = beforeCaret.split('\n').length - 1
          const column = beforeCaret.length - beforeCaret.lastIndexOf('\n') - 1
          setCompletionPosition({ left: Math.max(70, 70 + column * 7.8 - scroll.left), top: Math.max(9, 9 + (line + 1) * 21 - scroll.top) })
        })
        .catch((error: unknown) => { if (!controller.signal.aborted) console.error('Code completion failed:', error) })
    }, 60)
    return () => { window.clearTimeout(debounce); controller.abort() }
  }, [completionRequested, editorLanguageService, value, caretOffset, completionPrefix, activePythonTokens, scroll.left, scroll.top])

  useEffect(() => {
    if (!editorLanguageService?.diagnose) return
    const controller = new AbortController()
    const debounce = window.setTimeout(() => {
      void Promise.resolve().then(() => editorLanguageService.diagnose!(value, controller.signal)).then((diagnostics) => {
        if (controller.signal.aborted) return
        setLanguageDiagnostics({ source: value, languageId: editorLanguageService.id, items: diagnostics.filter((item) => Number.isInteger(item.startOffset)
          && Number.isInteger(item.endOffset)
          && item.startOffset >= 0
          && item.endOffset > item.startOffset
          && item.endOffset <= value.length) })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('Language diagnostics failed:', error)
      })
    }, 150)
    return () => {
      window.clearTimeout(debounce)
      controller.abort()
    }
  }, [editorLanguageService, value])

  const onScroll = () => {
    const element = textarea.current
    if (element) setScroll({ top: element.scrollTop, left: element.scrollLeft })
  }
  const updateCaret = (element: HTMLTextAreaElement) => {
    setCaretOffset(element.selectionStart)
    setCaretLine(element.value.slice(0, element.selectionStart).split('\n').length - 1)
    onCaretChange?.(element.selectionStart)
  }
  const applyCompletion = (item: EditorCompletionItem) => {
    const prefix = completionPrefix
    const startOffset = caretOffset - prefix.length
    const insertion = item.insertText ?? item.label
    onChange(`${value.slice(0, startOffset)}${insertion}${value.slice(caretOffset)}`)
    const nextCaret = startOffset + insertion.length
    setCompletionRequested(false)
    setCompletionItems([])
    requestAnimationFrame(() => {
      const element = textarea.current
      if (!element) return
      element.focus()
      element.setSelectionRange(nextCaret, nextCaret)
      updateCaret(element)
    })
  }
  return <div className="editor-canvas">
    <div className="current-line" aria-hidden="true" style={{ transform: `translateY(${caretLine * 21 - scroll.top}px)` }} />
    <div className="editor-gutter" aria-hidden="true" style={{ transform: `translateY(-${scroll.top}px)` }}>{lines.map((_, i) => <div key={i} className={`line-number${caretLine === i ? ' current' : ''}`}>{i + 1}</div>)}</div>
    <pre className="syntax-layer" aria-hidden="true" style={{ transform: `translate(${-scroll.left}px, -${scroll.top}px)` }}>{lines.map((line, i) => <div className="code-line" key={i}>{highlightLine(line, isPython, activePythonTokens, lineOffsets[i], activeDiagnostics)}</div>)}</pre>
    {completionRequested && completionPrefix && completionItems.length > 0 && <div className="completion-popup" role="listbox" aria-label="Code completion" style={{ left: completionPosition.left, top: completionPosition.top }}>
      {completionItems.map((item, index) => <button type="button" role="option" aria-selected={index === completionIndex} className={`completion-item${index === completionIndex ? ' selected' : ''}`} key={`${item.label}-${index}`} onMouseDown={(event) => event.preventDefault()} onClick={() => applyCompletion(item)}>
        <span className={`completion-kind completion-kind-${item.kind ?? 'text'}`}>{item.kind === 'variable' ? 'v' : item.kind === 'function' ? 'ƒ' : item.kind === 'class' ? 'C' : '·'}</span><span className="completion-label">{item.label}</span>{item.detail && <span className="completion-detail">{item.detail}</span>}
      </button>)}
    </div>}
    <textarea ref={textarea} className="code-input" aria-label={`Code editor for ${filePath}`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value} onChange={(event) => { onChange(event.target.value); updateCaret(event.currentTarget) }} onClick={(event) => { setCompletionRequested(false); updateCaret(event.currentTarget) }} onKeyUp={(event) => updateCaret(event.currentTarget)} onSelect={(event) => updateCaret(event.currentTarget)} onScroll={onScroll} onKeyDown={(event) => {
      const element = event.currentTarget
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault()
        setCompletionRequested(true)
        return
      }
      if (completionRequested && completionItems.length > 0 && event.key === 'ArrowDown') {
        event.preventDefault()
        setCompletionIndex((index) => (index + 1) % completionItems.length)
        return
      }
      if (completionRequested && completionItems.length > 0 && event.key === 'ArrowUp') {
        event.preventDefault()
        setCompletionIndex((index) => (index - 1 + completionItems.length) % completionItems.length)
        return
      }
      if (completionRequested && completionItems.length > 0 && (event.key === 'Enter' || event.key === 'Tab')) {
        event.preventDefault()
        applyCompletion(completionItems[completionIndex])
        return
      }
      if (event.key === 'Escape' && completionRequested) {
        setCompletionRequested(false)
        setCompletionItems([])
        return
      }
      if (event.key.length === 1 && /[A-Za-z_]/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) setCompletionRequested(true)
      else if (event.key === 'Backspace' || event.key === 'Delete') setCompletionRequested(true)
      else if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) setCompletionRequested(false)
      if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && editorLanguageService?.autoClosingPairs) {
        const pairEdit = resolveAutoClosingPair(value, { startOffset: element.selectionStart, endOffset: element.selectionEnd }, event.key, editorLanguageService.autoClosingPairs)
        if (pairEdit) {
          event.preventDefault()
          if (!pairEdit.skipExistingCloser) onChange(`${value.slice(0, pairEdit.range.startOffset)}${pairEdit.text}${value.slice(pairEdit.range.endOffset)}`)
          requestAnimationFrame(() => {
            element.focus()
            element.setSelectionRange(pairEdit.selectionStart, pairEdit.selectionEnd)
            updateCaret(element)
          })
          return
        }
      }
      if (event.key !== 'Tab' && event.key !== 'Enter') return
      event.preventDefault()
      const selection = { startOffset: element.selectionStart, endOffset: element.selectionEnd }
      const edit = editorKeyHandlers.dispatch({
        key: event.key,
        filePath,
        source: value,
        caretOffset: element.selectionStart,
        selection,
        shiftKey: event.shiftKey,
        indentSize: editorLanguageService?.tabSize ?? 2,
      })
      onChange(`${value.slice(0, edit.range.startOffset)}${edit.text}${value.slice(edit.range.endOffset)}`)
      requestAnimationFrame(() => {
        element.focus()
        element.setSelectionRange(edit.selectionStart, edit.selectionEnd)
        updateCaret(element)
      })
    }} />
  </div>
}
