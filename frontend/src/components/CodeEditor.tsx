import { useRef, useState } from 'react'

interface CodeEditorProps {
  filePath: string
  value: string
  onChange(value: string): void
  onCaretChange?(offset: number): void
}

const tokenPattern = /(?:\/\/.*|\b(?:import|from|export|function|const|let|return|if|throw|new|class|async|await|default|interface|type)\b|\b(?:true|false|null|undefined)\b|\b\d+\b|(['"`])(?:\\.|(?!\1)[^\\])*?\1|=>)/g
const pythonTokenPattern = /(?:#.*|\b(?:def|return|if|elif|else|for|while|in|not|and|or|is|import|from|as|class|try|except|finally|with|pass|break|continue|lambda|yield|async|await|raise|assert|global|nonlocal|del|match|case)\b|\b(?:True|False|None)\b|\b\d+\b|(['"])(?:\\.|(?!\1)[^\\])*?\1)/g

function highlightLine(line: string, isPython: boolean) {
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
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [caretLine, setCaretLine] = useState(0)
  const lines = value.split('\n')
  const isPython = filePath.endsWith('.py')
  const onScroll = () => {
    const element = textarea.current
    if (element) setScroll({ top: element.scrollTop, left: element.scrollLeft })
  }
  const updateCaret = (element: HTMLTextAreaElement) => {
    setCaretLine(element.value.slice(0, element.selectionStart).split('\n').length - 1)
    onCaretChange?.(element.selectionStart)
  }
  return <div className="editor-canvas">
    <div className="current-line" aria-hidden="true" style={{ transform: `translateY(${caretLine * 21 - scroll.top}px)` }} />
    <div className="editor-gutter" aria-hidden="true" style={{ transform: `translateY(-${scroll.top}px)` }}>{lines.map((_, i) => <div key={i} className={`line-number${caretLine === i ? ' current' : ''}`}>{i + 1}</div>)}</div>
    <pre className="syntax-layer" aria-hidden="true" style={{ transform: `translate(${-scroll.left}px, -${scroll.top}px)` }}>{lines.map((line, i) => <div className="code-line" key={i}>{highlightLine(line, isPython)}</div>)}</pre>
    <textarea ref={textarea} className="code-input" aria-label={`Code editor for ${filePath}`} spellCheck={false} autoCapitalize="off" autoCorrect="off" value={value} onChange={(event) => { onChange(event.target.value); updateCaret(event.currentTarget) }} onClick={(event) => updateCaret(event.currentTarget)} onKeyUp={(event) => updateCaret(event.currentTarget)} onSelect={(event) => updateCaret(event.currentTarget)} onScroll={onScroll} onKeyDown={(event) => {
      if (event.key === 'Tab') { event.preventDefault(); const el = event.currentTarget; const start = el.selectionStart; const end = el.selectionEnd; onChange(`${value.slice(0, start)}  ${value.slice(end)}`); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 2 }) }
    }} />
  </div>
}
