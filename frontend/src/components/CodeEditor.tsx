import { useEffect, useMemo, useRef, useState } from 'react'
import { editorCompletionContributors, editorKeyHandlers, editorLanguageServices, pluginRuntime } from '../platform/plugin-system/builtinPlugins.ts'
import { collectEditorCompletionItems } from '../platform/core/editorServices.ts'
import { collectInspectionDiagnostics } from '../platform/core/extensionApis.ts'
import type { EditorCompletionItem, EditorDiagnostic } from '../platform/core/editorServices.ts'
import { resolveAutoClosingPair } from '../platform/core/editorTyping.ts'
import { resolveCompletionEdit } from '../platform/core/editorCompletion.ts'

interface CodeEditorProps {
  filePath: string
  value: string
  onChange(value: string): void
  onCaretChange?(offset: number): void
  onDiagnosticsChange?(diagnostics: readonly EditorDiagnostic[]): void
  diagnosticNavigation?: { readonly offset: number; readonly requestId: number } | null
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
  const pattern = isPython ? pythonTokenPattern : tokenPattern
  const tokens = [...line.matchAll(pattern)].map((match) => {
    const text = match[0]
    const start = match.index ?? 0
    const end = start + text.length
    const kind = text.startsWith('//') || (isPython && text.startsWith('#')) ? 'comment' : /^['"`]/.test(text) ? 'string' : /^\d/.test(text) ? 'number' : text === '=>' ? 'operator' : /^(true|false|null|undefined|True|False|None)$/.test(text) ? 'literal' : 'keyword'
    return { start, end, text, kind }
  })
  const lineEndOffset = lineStartOffset + line.length
  const lineDiagnostics = diagnostics.filter((item) => item.startOffset < lineEndOffset && item.endOffset > lineStartOffset)
  const boundaries = new Set<number>([0, line.length])
  for (const token of tokens) {
    boundaries.add(token.start)
    boundaries.add(token.end)
  }
  for (const diagnostic of lineDiagnostics) {
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
    const token = tokens.find((candidate) => candidate.start <= start && candidate.end >= end)
    const diagnostic = lineDiagnostics.find((candidate) => candidate.startOffset < absoluteEnd && candidate.endOffset > absoluteStart)
    const classes = [token ? `tok-${token.kind}` : '', diagnostic ? `diagnostic-${diagnostic.severity}` : ''].filter(Boolean)
    result.push(classes.length
      ? <span className={classes.join(' ')} key={`${start}-${end}`} title={diagnostic?.message}>{text}</span>
      : text)
  }
  return result.length ? result : ' '
}

export function CodeEditor({ filePath, value, onChange, onCaretChange, onDiagnosticsChange, diagnosticNavigation }: CodeEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const completionPopup = useRef<HTMLDivElement>(null)
  const nextRequestId = useRef(0)
  const latestRequestId = useRef(0)
  const lastDiagnosticNavigationId = useRef(0)
  const [pythonLexResult, setPythonLexResult] = useState<PythonLexerResult | null>(null)
  const [languageDiagnostics, setLanguageDiagnostics] = useState<{ source: string; languageId: string; items: readonly EditorDiagnostic[] } | null>(null)
  const [inspectionDiagnostics, setInspectionDiagnostics] = useState<{ source: string; languageId: string; items: readonly EditorDiagnostic[] } | null>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [caretLine, setCaretLine] = useState(0)
  const [caretOffset, setCaretOffset] = useState(0)
  const [completionRequested, setCompletionRequested] = useState(false)
  const [completionItems, setCompletionItems] = useState<readonly EditorCompletionItem[]>([])
  const [completionIndex, setCompletionIndex] = useState(0)
  const [completionPosition, setCompletionPosition] = useState({ left: 70, top: 30 })
  const [hoveredDiagnostic, setHoveredDiagnostic] = useState<{ diagnostic: EditorDiagnostic; left: number; top: number } | null>(null)
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
  const activeLanguageDiagnostics = useMemo(() => languageDiagnostics?.source === value && languageDiagnostics.languageId === editorLanguageService?.id ? languageDiagnostics.items : [], [languageDiagnostics, value, editorLanguageService?.id])
  const activeInspectionDiagnostics = useMemo(() => inspectionDiagnostics?.source === value && inspectionDiagnostics.languageId === editorLanguageService?.id ? inspectionDiagnostics.items : [], [inspectionDiagnostics, value, editorLanguageService?.id])
  const lexicalDiagnostics: readonly EditorDiagnostic[] = useMemo(() => (activePythonTokens ?? []).flatMap((token) => {
    if (!/BAD_CHARACTER|INCONSISTENT_DEDENT/.test(token.type)) return []
    return [{ startOffset: token.start, endOffset: token.end, severity: 'error' as const, message: /INCONSISTENT_DEDENT/.test(token.type) ? 'Inconsistent indentation' : `Invalid Python token: ${token.text}`, source: 'Python CE lexer' }]
  }), [activePythonTokens])
  const activeDiagnostics = useMemo(() => [...activeLanguageDiagnostics, ...activeInspectionDiagnostics, ...lexicalDiagnostics], [activeLanguageDiagnostics, activeInspectionDiagnostics, lexicalDiagnostics])
  const completionPrefix = value.slice(0, caretOffset).match(/[A-Za-z_]\w*$/)?.[0] ?? ''

  // Capture the shortcut before React's delegated key handlers.
  useEffect(() => {
    const onCompletionShortcut = (event: KeyboardEvent) => {
      const target = event.target
      const isEditor = target instanceof HTMLTextAreaElement && target.classList.contains('code-input')
      const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
      if (!isEditor || !(event.ctrlKey || event.metaKey) || !isSpace) return
      event.preventDefault()
      event.stopPropagation()
      setCompletionItems([])
      setCompletionRequested(true)
    }
    window.addEventListener('keydown', onCompletionShortcut, true)
    return () => window.removeEventListener('keydown', onCompletionShortcut, true)
  }, [])

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
    if (!completionRequested || !editorLanguageService) return
    const prefix = completionPrefix
    const controller = new AbortController()
    const debounce = window.setTimeout(() => {
      const context = { languageId: editorLanguageService.id, source: value, caretOffset, prefix, signal: controller.signal }
      void collectEditorCompletionItems(editorCompletionContributors, context)
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
    if (!completionRequested || completionItems.length === 0) return
    const popup = completionPopup.current
    const selectedItem = popup?.querySelector<HTMLElement>(`[data-completion-index="${completionIndex}"]`)
    if (!popup || !selectedItem) return
    // IntelliJ keeps the selected lookup row visible while navigating the list.
    // Scroll only the popup, not the editor or the surrounding page.
    const popupBounds = popup.getBoundingClientRect()
    const itemBounds = selectedItem.getBoundingClientRect()
    if (itemBounds.bottom > popupBounds.bottom) popup.scrollTop += itemBounds.bottom - popupBounds.bottom
    else if (itemBounds.top < popupBounds.top) popup.scrollTop -= popupBounds.top - itemBounds.top
  }, [completionIndex, completionItems, completionRequested])

  useEffect(() => {
    onDiagnosticsChange?.(activeDiagnostics)
    return () => onDiagnosticsChange?.([])
  }, [activeDiagnostics, onDiagnosticsChange])

  useEffect(() => {
    if (!editorLanguageService) {
      setInspectionDiagnostics(null)
      return
    }
    const controller = new AbortController()
    const debounce = window.setTimeout(() => {
      void collectInspectionDiagnostics(pluginRuntime.inspections, {
        languageId: editorLanguageService.id,
        filePath,
        source: value,
        signal: controller.signal,
      }).then((items) => {
        if (!controller.signal.aborted) setInspectionDiagnostics({ source: value, languageId: editorLanguageService.id, items })
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) console.error('Plugin inspections failed:', error)
      })
    }, 150)
    return () => { window.clearTimeout(debounce); controller.abort() }
  }, [editorLanguageService, filePath, value])

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
  useEffect(() => {
    if (!diagnosticNavigation || diagnosticNavigation.requestId === lastDiagnosticNavigationId.current) return
    const element = textarea.current
    if (!element) return
    lastDiagnosticNavigationId.current = diagnosticNavigation.requestId
    const offset = Math.max(0, Math.min(diagnosticNavigation.offset, value.length))
    element.focus()
    element.setSelectionRange(offset, offset)
    const targetLine = value.slice(0, offset).split('\n').length - 1
    element.scrollTop = Math.max(0, targetLine * 21 - element.clientHeight + 42)
    setCaretOffset(offset)
    setCaretLine(targetLine)
    setScroll({ top: element.scrollTop, left: element.scrollLeft })
    onCaretChange?.(offset)
  }, [diagnosticNavigation, filePath, value, onCaretChange])

  const updateDiagnosticHover = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    if (activeDiagnostics.length === 0) {
      setHoveredDiagnostic(null)
      return
    }
    const element = event.currentTarget
    const bounds = element.getBoundingClientRect()
    const line = Math.floor((event.clientY - bounds.top + element.scrollTop - 9) / 21)
    if (line < 0 || line >= lineOffsets.length) {
      setHoveredDiagnostic(null)
      return
    }
    const column = Math.floor((event.clientX - bounds.left + element.scrollLeft - 70) / 7.83)
    if (column < 0 || column >= lines[line].length) {
      setHoveredDiagnostic(null)
      return
    }
    const offset = lineOffsets[line] + column
    const diagnostic = activeDiagnostics.find((item) => offset >= item.startOffset && offset < item.endOffset)
    if (!diagnostic) {
      setHoveredDiagnostic(null)
      return
    }
    setHoveredDiagnostic({
      diagnostic,
      left: Math.max(8, Math.min(event.clientX - bounds.left + 12, bounds.width - 320)),
      top: Math.max(8, Math.min(event.clientY - bounds.top + 18, bounds.height - 100)),
    })
  }
  const applyCompletion = (item: EditorCompletionItem, acceptWithTab = false) => {
    const edit = resolveCompletionEdit(value, caretOffset, completionPrefix, item, acceptWithTab)
    onChange(`${value.slice(0, edit.range.startOffset)}${edit.text}${value.slice(edit.range.endOffset)}`)
    const nextCaret = edit.selectionStart
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
    <div className="editor-gutter" aria-hidden="true" style={{ transform: `translateY(-${scroll.top}px)` }}>{lines.map((line, i) => {
      const lineStart = lineOffsets[i]
      const lineEnd = lineStart + line.length + (i < lines.length - 1 ? 1 : 0)
      const lineDiagnostics = activeDiagnostics.filter((diagnostic) => diagnostic.startOffset < lineEnd && diagnostic.endOffset > lineStart)
      const severity = lineDiagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'error' : lineDiagnostics.some((diagnostic) => diagnostic.severity === 'warning') ? 'warning' : lineDiagnostics.length ? 'information' : ''
      return <div key={i} className={`line-number${caretLine === i ? ' current' : ''}`}>{severity && <span className={`gutter-diagnostic gutter-diagnostic-${severity}`} title={lineDiagnostics[0].message}>●</span>}{i + 1}</div>
    })}</div>
    <pre className="syntax-layer" aria-hidden="true" style={{ transform: `translate(${-scroll.left}px, -${scroll.top}px)` }}>{lines.map((line, i) => <div className="code-line" key={i}>{highlightLine(line, isPython, activePythonTokens, lineOffsets[i], activeDiagnostics)}</div>)}</pre>
    {completionRequested && completionItems.length > 0 && <div ref={completionPopup} className="completion-popup" role="listbox" aria-label="Code completion" style={{ left: completionPosition.left, top: completionPosition.top }}>
      {completionItems.map((item, index) => <button type="button" role="option" data-completion-index={index} aria-selected={index === completionIndex} className={`completion-item${index === completionIndex ? ' selected' : ''}`} key={`${item.label}-${index}`} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setCompletionIndex(index)} onClick={() => applyCompletion(item)}>
        <span className="completion-label">{item.label}</span>
      </button>)}
    </div>}
    {hoveredDiagnostic && <div className={`diagnostic-tooltip diagnostic-tooltip-${hoveredDiagnostic.diagnostic.severity}`} role="tooltip" style={{ left: hoveredDiagnostic.left, top: hoveredDiagnostic.top }}><div className="diagnostic-tooltip-heading"><span className="diagnostic-tooltip-icon">{hoveredDiagnostic.diagnostic.severity === 'error' ? '×' : hoveredDiagnostic.diagnostic.severity === 'warning' ? '!' : 'i'}</span><strong>{hoveredDiagnostic.diagnostic.severity === 'error' ? 'Error' : hoveredDiagnostic.diagnostic.severity === 'warning' ? 'Warning' : 'Information'}</strong></div><div className="diagnostic-tooltip-message">{hoveredDiagnostic.diagnostic.message}</div>{hoveredDiagnostic.diagnostic.source && <div className="diagnostic-tooltip-source">{hoveredDiagnostic.diagnostic.source}</div>}</div>}
    <textarea ref={textarea} className="code-input" aria-label={`Code editor for ${filePath}`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value} onChange={(event) => { setCompletionItems([]); onChange(event.target.value); updateCaret(event.currentTarget) }} onClick={(event) => { setCompletionRequested(false); updateCaret(event.currentTarget) }} onKeyUp={(event) => updateCaret(event.currentTarget)} onSelect={(event) => updateCaret(event.currentTarget)} onScroll={onScroll} onMouseMove={updateDiagnosticHover} onMouseLeave={() => setHoveredDiagnostic(null)} onKeyDown={(event) => {
      const element = event.currentTarget
      if ((event.ctrlKey || event.metaKey) && event.code === 'Space') {
        event.preventDefault()
        setCompletionItems([])
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
        applyCompletion(completionItems[completionIndex], event.key === 'Tab')
        return
      }
      if (event.key === 'Escape' && completionRequested) {
        setCompletionRequested(false)
        setCompletionItems([])
        return
      }
      if (event.key.length === 1 && /[A-Za-z_]/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { setCompletionItems([]); setCompletionRequested(true) }
      else if (event.key === 'Backspace' || event.key === 'Delete') { setCompletionItems([]); setCompletionRequested(true) }
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
