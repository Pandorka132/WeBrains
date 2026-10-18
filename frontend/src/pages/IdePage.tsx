import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CodeEditor } from '../components/CodeEditor'
import { ProjectTree } from '../components/ProjectTree'
import { DocumentModel } from '../platform/document.ts'
import { EditorModel } from '../platform/editor.ts'
import type { MemoryFile } from '../platform/vfs.ts'
import { createSampleProject } from '../workspace/sampleProject'

type OpenTab = { file: MemoryFile; document: DocumentModel; editor: EditorModel }
type Panel = 'Problems' | 'Terminal' | 'Run' | 'Debug'

export function IdePage() {
  const projectId = new URLSearchParams(window.location.search).get('project') ?? 'aurora-dashboard'
  const project = useMemo(() => createSampleProject(projectId), [projectId])
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState('')
  const [panel, setPanel] = useState<Panel>('Problems')
  const [leftOpen, setLeftOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const [dialog, setDialog] = useState<'search' | 'new' | 'actions' | null>(null)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const openingPaths = useRef(new Set<string>())
  const [selection, setSelection] = useState({ key: '', index: 0 })

  const active = tabs.find((tab) => tab.file.path === activePath)
  const openFile = useCallback((file: MemoryFile) => {
    setActivePath(file.path)
    if (openingPaths.current.has(file.path)) return
    openingPaths.current.add(file.path)
    void file.readText().then((text) => {
      setTabs((current) => {
        if (current.some((tab) => tab.file.path === file.path)) return current
        const document = new DocumentModel(text)
        return [...current, { file, document, editor: new EditorModel(document) }]
      })
    }).finally(() => openingPaths.current.delete(file.path))
  }, [])

  useEffect(() => {
    const first = project.files.find('src/App.tsx')
    if (first && !first.isDirectory) queueMicrotask(() => openFile(first))
  }, [openFile, project])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === 'p') { event.preventDefault(); setDialog('search'); setQuery('') }
      if (mod && event.key.toLowerCase() === 'f') { event.preventDefault(); setDialog('search'); setQuery('') }
      if (mod && event.key.toLowerCase() === 'n') { event.preventDefault(); setDialog('new') }
      if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); setNotice('Saved in this browser session') }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'a') { event.preventDefault(); setDialog('actions'); setQuery('') }
      if (event.altKey && event.key === '1') { event.preventDefault(); setLeftOpen((open) => !open) }
      if (event.altKey && event.key === '4') { event.preventDefault(); setBottomOpen((open) => !open) }
      if (event.key === 'Escape') { setDialog(null); setMenu(null) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const updateText = (text: string) => {
    if (!active) return
    active.document.replace({ startOffset: 0, endOffset: active.document.textLength }, text)
    active.file.write(text)
    setTabs((current) => [...current])
  }

  const makeFile = (name: string) => {
    const clean = name.trim().replace(/^\/+/, '')
    if (!clean) return
    const file = project.files.writeText(clean, '// Start writing here\n')
    setDialog(null)
    openFile(file)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.max(180, Math.min(440, moveEvent.clientX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const files = (() => {
    const all: MemoryFile[] = []
    const visit = (directory: import('../platform/vfs.ts').MemoryDirectory) => directory.children().forEach((entry) => entry.isDirectory ? visit(entry) : all.push(entry as MemoryFile))
    visit(project.files.root)
    return all
  })()
  const searchResults = files.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query.toLowerCase()))
  const actionItems = [
    { label: 'Find in project', shortcut: 'Ctrl+F', run: () => { setDialog('search'); setQuery('') } },
    { label: 'New file', shortcut: 'Ctrl+N', run: () => { setDialog('new'); setQuery('') } },
    { label: 'Toggle project tool window', shortcut: 'Alt+1', run: () => setLeftOpen((open) => !open) },
    { label: 'Toggle bottom tool window', shortcut: 'Alt+4', run: () => setBottomOpen((open) => !open) },
    { label: 'Open terminal panel', shortcut: '', run: () => { setPanel('Terminal'); setBottomOpen(true) } },
    { label: 'Run current project', shortcut: '', run: () => { setPanel('Run'); setBottomOpen(true) } },
  ].filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
  const dialogResults = dialog === 'actions' ? actionItems : searchResults
  const selectionKey = `${dialog ?? ''}:${query}`
  const selectedResult = selection.key === selectionKey ? selection.index : 0
  const moveDialogSelection = (direction: -1 | 1) => {
    if (!dialogResults.length) return
    setSelection({ key: selectionKey, index: (selectedResult + direction + dialogResults.length) % dialogResults.length })
  }
  const chooseDialogResult = () => {
    if (dialog === 'new') { makeFile(query); return }
    if (dialog === 'actions') {
      const action = actionItems[selectedResult]
      if (action) {
        action.run()
        if (!['Find in project', 'New file'].includes(action.label)) setDialog(null)
      }
      return
    }
    const file = searchResults[selectedResult]
    if (file) { openFile(file); setDialog(null) }
  }

  return <main className="ide-shell" onClick={() => { if (menu) setMenu(null) }}>
    <header className="ide-topbar">
      <a href="/" className="ide-brand" aria-label="WebBrains projects"><span className="brand-mark">W</span></a>
      <div className="project-switcher"><span className="project-switch-icon">✦</span><strong>{project.name}</strong><span className="switch-chevron">⌄</span></div>
      <nav className="menu-bar" aria-label="Main menu">{['File', 'Edit', 'View', 'Navigate', 'Code', 'Run', 'Tools', 'Help'].map((item) => <div className="menu-wrap" key={item}><button type="button" className="menu-item" aria-expanded={menu === item} onClick={(event) => { event.stopPropagation(); setMenu(menu === item ? null : item) }}>{item}</button>{menu === item && <div className="menu-popover">{(item === 'File' ? [['New File', 'Ctrl+N', () => setDialog('new')], ['Open Recent', '', () => setDialog('search')], ['Save All', 'Ctrl+S', () => setNotice('Saved in this browser session')]] : item === 'Edit' ? [['Find in Project', 'Ctrl+F', () => setDialog('search')], ['Select All', 'Ctrl+A', () => document.querySelector<HTMLTextAreaElement>('.code-input')?.select()]] : item === 'Run' ? [['Run current project', '', () => { setPanel('Run'); setBottomOpen(true) }], ['Debug current project', '', () => { setPanel('Debug'); setBottomOpen(true) }]] : [['Search files', 'Ctrl+P', () => setDialog('search')], ['Project tool window', '', () => setLeftOpen(!leftOpen)], ['Terminal', '', () => { setPanel('Terminal'); setBottomOpen(true) }]]).map(([label, shortcut, action]) => <button key={label as string} type="button" onClick={() => { (action as () => void)(); setMenu(null) }}><span>{label as string}</span><small>{shortcut as string}</small></button>)}</div>}</div>)}</nav>
      <div className="topbar-spacer" />
      <button className="run-config" type="button" onClick={() => setNotice('Browser preview is not connected yet')}><span className="run-config-icon">◉</span> Current File <span>⌄</span></button>
      <button className="toolbar-icon run-button" aria-label="Run current file" title="Run current file" type="button" onClick={() => { setPanel('Run'); setBottomOpen(true); setNotice('Preview is not configured for this sample project yet') }}>▶</button>
      <button className="toolbar-icon" aria-label="Debug current file" title="Debug current file" type="button" onClick={() => { setPanel('Debug'); setBottomOpen(true) }}>◇</button>
      <button className="toolbar-icon" aria-label="Search everywhere" title="Search everywhere (Ctrl+P)" type="button" onClick={() => setDialog('search')}>⌕</button>
    </header>
    <div className="ide-workbench">
      <aside className="tool-stripe" aria-label="Tool windows"><button className={leftOpen ? 'stripe-active' : ''} type="button" title="Project" aria-label="Toggle project tool window" onClick={() => setLeftOpen(!leftOpen)}>▤</button><button type="button" title="Structure" aria-label="Structure tool window" onClick={() => setNotice('Structure view is not available for this file')}>⌘</button><div className="stripe-spacer" /><button className={bottomOpen ? 'stripe-active' : ''} type="button" title="Problems" aria-label="Toggle bottom tool window" onClick={() => setBottomOpen(!bottomOpen)}>⚠</button><button type="button" title="Terminal" aria-label="Open terminal panel" onClick={() => { setPanel('Terminal'); setBottomOpen(true) }}>▱</button></aside>
      {leftOpen && <aside className="project-panel" style={{ width: sidebarWidth }}><div className="panel-heading"><span>Project</span><button type="button" aria-label="Project options" onClick={() => setNotice('Project files live in temporary browser memory')}>···</button><button type="button" aria-label="Collapse project panel" onClick={() => setLeftOpen(false)}>−</button></div><div className="project-root-label"><span>⌄</span><span className="folder-icon">▰</span><strong>{project.name}</strong><span className="root-tag">project</span></div><ProjectTree root={project.files.root} activePath={activePath} onOpen={openFile} /><div className="project-panel-foot">In-memory sample project</div></aside>}
      {leftOpen && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize project panel" onPointerDown={startResize} />}
      <section className="editor-area" aria-label="Editor workspace">
        <div className="tabs-row">{tabs.map((tab) => <div role="tab" aria-selected={activePath === tab.file.path} tabIndex={0} className={`editor-tab${activePath === tab.file.path ? ' active' : ''}`} key={tab.file.path} onClick={() => setActivePath(tab.file.path)} onKeyDown={(event) => { if (event.key === 'Enter') setActivePath(tab.file.path) }}><span className="tab-type">{tab.file.name.endsWith('.tsx') || tab.file.name.endsWith('.ts') ? 'TS' : tab.file.name.endsWith('.css') ? '#' : '◇'}</span><span>{tab.file.name}</span><button type="button" aria-label={`Close ${tab.file.name}`} onClick={(event) => { event.stopPropagation(); const rest = tabs.filter((candidate) => candidate !== tab); setTabs(rest); if (activePath === tab.file.path) setActivePath(rest.at(-1)?.file.path ?? '') }}>{'×'}</button></div>)}<button className="new-tab" type="button" aria-label="Create new file" onClick={() => setDialog('new')}>＋</button><div className="tabs-fill" /><button className="toolbar-icon tab-search" type="button" aria-label="Search files" onClick={() => setDialog('search')}>⌕</button></div>
        {active ? <><div className="breadcrumbs"><a href="#project">{project.name}</a><span>›</span><a href="#src">{active.file.path.split('/').slice(-2, -1)[0]}</a><span>›</span><strong>{active.file.name}</strong></div><CodeEditor filePath={active.file.path} value={active.document.text} onChange={updateText} onCaretChange={(offset) => active.editor.setCaretOffset(offset)} /><div className="editor-hint">{active.file.name.endsWith('.tsx') ? 'TypeScript JSX' : active.file.name.endsWith('.ts') ? 'TypeScript' : active.file.name.endsWith('.css') ? 'CSS' : 'Text'} <span>·</span> UTF-8 <span>·</span> LF</div></> : <div className="empty-editor"><span className="brand-mark">W</span><p>Open a file from the Project panel</p><kbd>Ctrl P</kbd><span>Search files</span></div>}
        {bottomOpen && <section className="bottom-panel" aria-label="Tool window"><div className="bottom-tabs">{(['Problems', 'Terminal', 'Run', 'Debug'] as Panel[]).map((name) => <button type="button" className={panel === name ? 'active' : ''} key={name} onClick={() => setPanel(name)}>{name}{name === 'Problems' && <span className="problem-count">0</span>}</button>)}<div className="bottom-fill" /><button className="panel-collapse" type="button" aria-label="Hide bottom tool window" onClick={() => setBottomOpen(false)}>⌄</button></div><div className="bottom-content">{panel === 'Problems' ? <><span className="success-check">✓</span><span>No problems detected</span><span className="muted">in this sample project</span></> : panel === 'Terminal' ? <div className="terminal-content"><span className="terminal-prompt">webbrains@browser</span><span>:</span><span className="terminal-path">~/aurora-dashboard</span><span>$</span><span className="muted">This is a local preview panel. OS shell access is not available in the browser.</span></div> : panel === 'Run' ? <span className="muted">Run configurations are a UI placeholder. Browser preview is not configured for this project.</span> : <span className="muted">Browser debugging is not connected to a runtime.</span>}</div></section>}
      </section>
    </div>
    <footer className="status-bar"><div><span className="status-branch">⑂</span><span>main</span><span className="status-separator">|</span><span>WebBrains</span></div><div className="status-right"><span>{active ? (() => { const before = active.document.text.slice(0, active.editor.caretOffset); const line = before.split('\n'); return `Ln ${line.length}, Col ${line.at(-1)!.length + 1}` })() : 'No file selected'}</span><span>Spaces: 2</span><span>UTF-8</span><span>{active?.file.name.endsWith('.css') ? 'CSS' : active?.file.name.endsWith('.json') ? 'JSON' : 'TypeScript'}</span><span className="status-check">✓</span></div></footer>
    {notice && <div role="status" className="toast-notice">{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="quick-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'new' ? 'New file' : dialog === 'actions' ? 'Find action' : 'Search files'}><div className="quick-input-row"><span>{dialog === 'new' ? '＋' : dialog === 'actions' ? '⌘' : '⌕'}</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={dialog === 'new' ? 'File path, e.g. src/components/Card.tsx' : dialog === 'actions' ? 'Type an action name' : 'Search files by name…'} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveDialogSelection(1) } else if (event.key === 'ArrowUp') { event.preventDefault(); moveDialogSelection(-1) } else if (event.key === 'Enter') { event.preventDefault(); chooseDialogResult() } }} /></div>{dialog === 'new' ? <div className="dialog-help">A new file will be created in the browser workspace.</div> : <div className="quick-results">{dialog === 'actions' ? actionItems.map((action, index) => <button key={action.label} className={selectedResult === index ? 'result-active' : ''} type="button" onMouseEnter={() => setSelection({ key: selectionKey, index })} onClick={() => { action.run(); if (!['Find in project', 'New file'].includes(action.label)) setDialog(null) }}><span className="file-type type-other">⌘</span><span>{action.label}</span><small>{action.shortcut}</small></button>) : searchResults.map((file, index) => <button key={file.path} className={selectedResult === index ? 'result-active' : ''} type="button" onMouseEnter={() => setSelection({ key: selectionKey, index })} onClick={() => { openFile(file); setDialog(null) }}><span className="file-type type-ts">{file.name.endsWith('.tsx') || file.name.endsWith('.ts') ? 'TS' : '◇'}</span><span>{file.name}</span><small>{file.path}</small></button>)}{dialog === 'actions' && actionItems.length === 0 && <p>No matching actions</p>}{dialog === 'search' && searchResults.length === 0 && <p>No matching files</p>}</div>}<div className="dialog-footer"><span>↑↓ to navigate</span><span>Enter to open</span><span>Esc to close</span></div></section></div>}
  </main>
}
