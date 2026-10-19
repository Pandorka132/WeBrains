import { useState } from 'react'
import type { VirtualDirectory, VirtualFile } from '../platform/core/vfs.ts'

interface ProjectTreeProps {
  root: VirtualDirectory
  rootName: string
  onOpen(file: VirtualFile): void
  onCreateFile(path: string): void
  onCreateFolder(path: string): void
  onDelete(path: string): void | Promise<void>
}

type TreeEntryProps = Pick<ProjectTreeProps, 'onOpen'> & { entry: VirtualFile; depth: number; selectedPath: string; onSelectDirectory(path: string): void; onSelectPath(path: string): void }
type TreeContextMenu = { x: number; y: number; path: string; kind: 'root' | 'directory' | 'file'; file?: VirtualFile }

function TreeEntry({ entry, depth, selectedPath, onSelectDirectory, onSelectPath, onOpen, initialExpanded, expansionKey, onContextMenu }: TreeEntryProps & { initialExpanded: boolean; expansionKey: number; onContextMenu(menu: TreeContextMenu): void }) {
  const [expanded, setExpanded] = useState(initialExpanded)
  if (entry.isDirectory) {
    const directory = entry as VirtualDirectory
    return <div className="tree-folder">
      <div className={`tree-folder-row${expanded ? ' folder-expanded' : ''}${selectedPath === directory.path ? ' directory-selected' : ''}`} style={{ paddingLeft: `${8 + depth * 14}px` }} onContextMenu={(event) => { event.preventDefault(); onSelectDirectory(directory.path); onSelectPath(directory.path); onContextMenu({ x: event.clientX, y: event.clientY, path: directory.path, kind: 'directory' }) }} tabIndex={0} onClick={() => { onSelectDirectory(directory.path); onSelectPath(directory.path);  }} onDoubleClick={() => setExpanded((value) => !value)}>
        <button type="button" className="folder-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${directory.name}`} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); setExpanded((value) => !value) }}><img className="folder-caret" src={`${import.meta.env.BASE_URL}icons/intellij/chevronRight.svg`} alt="" aria-hidden="true" /></button>
        <img className="tree-item-icon folder-icon" src={`${import.meta.env.BASE_URL}icons/intellij/folder.svg`} alt="" aria-hidden="true" />
        <span className="tree-entry-name">{directory.name}</span>
      </div>
      {expanded && <div className="tree-folder-children">{directory.children().map((child) => <TreeEntry key={`${child.path}:${expansionKey}`} entry={child} depth={depth + 1} onOpen={onOpen} selectedPath={selectedPath} onSelectDirectory={onSelectDirectory} onSelectPath={onSelectPath} initialExpanded={initialExpanded} expansionKey={expansionKey} onContextMenu={onContextMenu} />)}</div>}
    </div>
  }

  const file = entry
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const icon = extension === 'py' ? 'python.svg' : ['ts', 'tsx'].includes(extension) ? 'typeScript.svg' : ['js', 'jsx'].includes(extension) ? 'javaScript.svg' : extension === 'css' ? 'css.svg' : extension === 'html' ? 'html.svg' : extension === 'json' ? 'json.svg' : extension === 'md' ? 'markdown.svg' : 'text.svg'
  const parentPath = file.path.split('/').slice(0, -1).join('/')
  return <button type="button" className={`tree-file${selectedPath === file.path ? ' active' : ''}`} style={{ paddingLeft: `${24 + depth * 14}px` }} onContextMenu={(event) => { event.preventDefault(); onSelectPath(file.path); onSelectDirectory(parentPath); onContextMenu({ x: event.clientX, y: event.clientY, path: file.path, kind: 'file', file }) }} onClick={() => { onSelectPath(file.path); onSelectDirectory(parentPath);  }} onDoubleClick={() => onOpen(file)} title={file.path}>
    <img className="tree-item-icon file-type" src={`${import.meta.env.BASE_URL}icons/intellij/${icon}`} alt="" aria-hidden="true" /><span className="tree-entry-name">{file.name}</span>
  </button>
}

export function ProjectTree({ root, rootName, onOpen, onCreateFile, onCreateFolder, onDelete }: ProjectTreeProps) {
  const [selectedDirectory, setSelectedDirectory] = useState('')
  const [selectedPath, setSelectedPath] = useState('')
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [rootExpanded, setRootExpanded] = useState(true)
  const [expandNested, setExpandNested] = useState(true)
  const [expansionKey, setExpansionKey] = useState(0)
  const [contextMenu, setContextMenu] = useState<TreeContextMenu | null>(null)
  const [contextNewOpen, setContextNewOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string } | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const expandAll = () => { setRootExpanded(true); setExpandNested(true); setExpansionKey((key) => key + 1); setContextMenu(null) }
  const collapseAll = () => { setRootExpanded(true); setExpandNested(false); setExpansionKey((key) => key + 1); setContextMenu(null) }
  const createFile = (path: string) => { setNewMenuOpen(false); setContextNewOpen(false); setContextMenu(null); onCreateFile(path) }
  const createFolder = (path: string) => { setNewMenuOpen(false); setContextNewOpen(false); setContextMenu(null); onCreateFolder(path) }
  const showContextMenu = (menu: TreeContextMenu) => { setContextNewOpen(false); setContextMenu(menu) }
  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteError('')
    try {
      await onDelete(deleteTarget.path)
      setDeleteTarget(null)
      setContextMenu(null)
      setSelectedPath('')
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : 'Could not delete the selected item.')
    }
  }
  return <div className="project-tree" onClick={() => { setNewMenuOpen(false); setContextNewOpen(false); setContextMenu(null) }} onKeyDown={(event) => { if (event.key === 'Escape') { setNewMenuOpen(false); setContextNewOpen(false); setContextMenu(null) } else if (event.key === 'Delete' && selectedPath) { const entry = root.find(selectedPath); if (entry) { event.preventDefault(); setDeleteTarget({ path: selectedPath, name: entry.name }); setDeleteError('') } } }}>
    <div className="project-tree-toolbar" role="toolbar" aria-label="Project tree actions">
      <div className="project-tree-new-action">
        <button type="button" className="project-tree-new-button" aria-label="New" title="New" aria-expanded={newMenuOpen} onClick={(event) => { event.stopPropagation(); setNewMenuOpen((open) => !open) }}><img src={`${import.meta.env.BASE_URL}icons/intellij/add.svg`} alt="" aria-hidden="true" /></button>
        {newMenuOpen && <div className="project-tree-new-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); createFile(selectedDirectory) }}><img src={`${import.meta.env.BASE_URL}icons/intellij/addFile.svg`} alt="" aria-hidden="true" />File</button>
          <button type="button" role="menuitem" onClick={() => { setNewMenuOpen(false); createFolder(selectedDirectory) }}><img src={`${import.meta.env.BASE_URL}icons/intellij/addDirectory.svg`} alt="" aria-hidden="true" />Directory</button>
        </div>}
      </div>
      <button type="button" className="project-tree-action" title="Expand All" aria-label="Expand All" onClick={(event) => { event.stopPropagation(); expandAll() }}><img src={`${import.meta.env.BASE_URL}icons/intellij/expandAll.svg`} alt="" aria-hidden="true" /></button>
      <button type="button" className="project-tree-action" title="Collapse All" aria-label="Collapse All" onClick={(event) => { event.stopPropagation(); collapseAll() }}><img src={`${import.meta.env.BASE_URL}icons/intellij/collapseAll.svg`} alt="" aria-hidden="true" /></button>
    </div>
    <div className={`tree-root-row${rootExpanded ? ' folder-expanded' : ''}${selectedPath === '' ? ' directory-selected' : ''}`} aria-label={`Project root ${rootName}`} onContextMenu={(event) => { event.preventDefault(); setSelectedDirectory(''); setSelectedPath(''); showContextMenu({ x: event.clientX, y: event.clientY, path: '', kind: 'root' }) }} onClick={() => { setSelectedDirectory(''); setSelectedPath('') }}>
      <button type="button" className="folder-toggle" aria-label={`${rootExpanded ? 'Collapse' : 'Expand'} ${rootName}`} aria-expanded={rootExpanded} onClick={(event) => { event.stopPropagation(); setRootExpanded((value) => !value) }}><img className="folder-caret" src={`${import.meta.env.BASE_URL}icons/intellij/chevronRight.svg`} alt="" aria-hidden="true" /></button><img className="tree-item-icon folder-icon" src={`${import.meta.env.BASE_URL}icons/intellij/folder.svg`} alt="" aria-hidden="true" /><strong>{rootName}</strong>
    </div>
    {rootExpanded && <div className="tree-root-children">{root.children().map((entry) => <TreeEntry key={`${entry.path}:${expansionKey}`} entry={entry} depth={1} onOpen={onOpen} selectedPath={selectedPath} onSelectDirectory={setSelectedDirectory} onSelectPath={setSelectedPath} initialExpanded={expandNested} expansionKey={expansionKey} onContextMenu={showContextMenu} />)}</div>}
    {contextMenu && <div className="tree-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      <div className="tree-context-submenu-anchor" onMouseEnter={() => setContextNewOpen(true)} onMouseLeave={() => setContextNewOpen(false)}>
        <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={contextNewOpen} className="tree-context-submenu-trigger" onFocus={() => setContextNewOpen(true)} onClick={() => setContextNewOpen((open) => !open)}><span>New</span><span className="tree-context-chevron">›</span></button>
        {contextNewOpen && <div className="tree-context-submenu" role="menu" onMouseEnter={() => setContextNewOpen(true)} onMouseLeave={() => setContextNewOpen(false)}>
          <button type="button" role="menuitem" onClick={() => createFile(contextMenu.kind === 'file' ? contextMenu.path.split('/').slice(0, -1).join('/') : contextMenu.path)}><img src={`${import.meta.env.BASE_URL}icons/intellij/addFile.svg`} alt="" aria-hidden="true" />File…</button>
          <button type="button" role="menuitem" onClick={() => createFolder(contextMenu.kind === 'file' ? contextMenu.path.split('/').slice(0, -1).join('/') : contextMenu.path)}><img src={`${import.meta.env.BASE_URL}icons/intellij/addDirectory.svg`} alt="" aria-hidden="true" />Directory…</button>
        </div>}
      </div>
      {contextMenu.kind !== 'root' && <>
        <div className="tree-context-separator" />
        <button type="button" role="menuitem" onClick={() => { setDeleteTarget({ path: contextMenu.path, name: contextMenu.path.split('/').at(-1) ?? contextMenu.path }); setDeleteError(''); setContextMenu(null) }}>Delete</button>
      </>}
    </div>}
    {deleteTarget && <div className="modal-backdrop tree-delete-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null) }}>
      <section className="tree-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="tree-delete-title" aria-describedby="tree-delete-description">
        <h2 id="tree-delete-title">Delete</h2>
        <p id="tree-delete-description">Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
        {deleteError && <div className="landing-error" role="alert">{deleteError}</div>}
        <div className="tree-delete-actions"><button type="button" className="dialog-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="tree-delete-confirm" onClick={() => void confirmDelete()}>Delete</button></div>
      </section>
    </div>}
  </div>
}
