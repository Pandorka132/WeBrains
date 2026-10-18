import type { MemoryDirectory, MemoryFile, VirtualFile } from '../platform/vfs.ts'

interface ProjectTreeProps {
  root: MemoryDirectory
  activePath: string
  onOpen(file: MemoryFile): void
}

function TreeEntry({ entry, depth, activePath, onOpen }: { entry: VirtualFile; depth: number; activePath: string; onOpen(file: MemoryFile): void }) {
  if (entry.isDirectory) {
    const directory = entry as MemoryDirectory
    return <details className="tree-folder" open><summary style={{ paddingLeft: `${12 + depth * 14}px` }}><span className="folder-caret">›</span><span className="folder-icon">▰</span>{directory.name}</summary><div>{directory.children().map((child) => <TreeEntry key={child.path} entry={child} depth={depth + 1} activePath={activePath} onOpen={onOpen} />)}</div></details>
  }
  const file = entry as MemoryFile
  const icon = file.name.endsWith('.tsx') || file.name.endsWith('.ts') ? 'TS' : file.name.endsWith('.css') ? '#' : file.name.endsWith('.html') ? '◇' : file.name.endsWith('.json') ? '{}' : '≡'
  return <button type="button" className={`tree-file${activePath === file.path ? ' active' : ''}`} style={{ paddingLeft: `${28 + depth * 14}px` }} onClick={() => onOpen(file)}><span className={`file-type type-${icon === 'TS' ? 'ts' : icon === '#' ? 'css' : icon === '{}' ? 'json' : 'other'}`}>{icon}</span>{file.name}</button>
}

export function ProjectTree({ root, activePath, onOpen }: ProjectTreeProps) {
  return <div className="project-tree">{root.children().map((entry) => <TreeEntry key={entry.path} entry={entry} depth={0} activePath={activePath} onOpen={onOpen} />)}</div>
}
