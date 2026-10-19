import { useCallback, useEffect, useRef, useState } from 'react'
import { CodeEditor } from '../components/CodeEditor'
import { ProjectTree } from '../components/ProjectTree'
import { DocumentModel } from '../platform/core/document.ts'
import { EditorModel } from '../platform/core/editor.ts'
import { isLikelyBinaryFileName, MemoryFileSystem } from '../platform/core/vfs.ts'
import type { VirtualFile } from '../platform/core/vfs.ts'
import { openWorkspace, type ProjectWorkspace } from '../platform/web-runtime/providers.ts'
import { createSampleProject } from '../workspace/sampleProject'
import { appUrl, getAppLocation, navigateApp } from '../utils/routing.ts'

type OpenTab = { file: VirtualFile; document: DocumentModel; editor: EditorModel }
type ToolWindow = 'Project' | 'Structure' | 'Problems' | 'Terminal' | 'Run' | 'Debug'
type DockSide = 'left' | 'left-bottom' | 'right' | 'right-bottom' | 'bottom' | 'bottom-right'
type DragPreview = { side: DockSide; beforeTool: ToolWindow | null }
type Panel = ToolWindow
const toolWindows: ToolWindow[] = ['Project', 'Structure', 'Problems', 'Terminal']
const defaultToolSides: Record<ToolWindow, DockSide> = { Project: 'left', Structure: 'left-bottom', Problems: 'bottom', Terminal: 'bottom', Run: 'bottom-right', Debug: 'bottom-right' }
const toolIcon: Record<ToolWindow, string> = { Project: 'project', Structure: 'structure', Problems: 'problems', Terminal: 'terminal', Run: 'run', Debug: 'debug' }

function projectInitials(name: string) {
  const words = name.trim().replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase()
  return Array.from(words[0] ?? 'WB').slice(0, 2).join('').toUpperCase()
}

function projectIconStyle(name: string): React.CSSProperties {
  // A stable, name-seeded blue palette: reopening a project never changes its icon.
  let hash = 2166136261
  for (const character of name) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  const hue = 205 + (hash >>> 0) % 22
  return { background: `linear-gradient(135deg, hsl(${hue} 82% 67%), hsl(${hue + 8} 76% 43%))` }
}

function ToolIcon({ tool }: { tool: ToolWindow }) {
  return <img className="tool-window-icon" src={`${import.meta.env.BASE_URL}icons/intellij/${toolIcon[tool]}.svg`} alt="" aria-hidden="true" draggable={false} />
}

function ToolWindowContent({ tool }: { tool: ToolWindow }) {
  if (tool === 'Structure') return <div className="dock-placeholder compact"><strong>Structure</strong><small>Structure navigation is not available for this file yet.</small></div>
  if (tool === 'Problems') return <><span className="success-check">✓</span><span>No problems detected</span><span className="muted">in this sample project</span></>
  if (tool === 'Terminal') return <div className="terminal-content"><span className="terminal-prompt">webbrains@browser</span><span>:</span><span className="terminal-path">~/aurora-dashboard</span><span>$</span><span className="muted">This is a local preview panel. OS shell access is not available in the browser.</span></div>
  if (tool === 'Run') return <span className="muted">Run configurations are a UI placeholder. Browser preview is not configured for this project.</span>
  return <span className="muted">Browser debugging is not connected to a runtime.</span>
}
function readToolOrder(): ToolWindow[] {
  try {
    const saved = JSON.parse(localStorage.getItem('webrains.tool-window-order') ?? 'null') as unknown
    const valid = Array.isArray(saved) ? [...new Set(saved.filter((tool): tool is ToolWindow => typeof tool === 'string' && toolWindows.includes(tool as ToolWindow)))] : []
    return [...valid, ...toolWindows.filter((tool) => !valid.includes(tool))]
  } catch { return toolWindows }
}

function readToolSides(): Record<ToolWindow, DockSide> {
  try {
    const saved = JSON.parse(localStorage.getItem('webrains.tool-window-layout') ?? 'null') as Partial<Record<ToolWindow, DockSide>> | null
    const layoutVersion = localStorage.getItem('webrains.tool-window-layout-version')
    const validSides: DockSide[] = ['left', 'left-bottom', 'right', 'right-bottom', 'bottom', 'bottom-right']
    const sanitized = Object.fromEntries(Object.entries(saved ?? {})
      .filter(([tool, side]) => toolWindows.includes(tool as ToolWindow) && validSides.includes(side as DockSide))
      .map(([tool, side]) => [tool, side])) as Partial<Record<ToolWindow, DockSide>>
    const migrated = { ...defaultToolSides, ...sanitized }
    if (saved && layoutVersion !== '4') {
      // In layout v3, these tools were incorrectly assigned to the lower side-panel groups.
      if (migrated.Problems === 'left-bottom') migrated.Problems = 'bottom'
      if (migrated.Terminal === 'left-bottom') migrated.Terminal = 'bottom'
      if (migrated.Run === 'right-bottom') migrated.Run = 'bottom-right'
      if (migrated.Debug === 'right-bottom') migrated.Debug = 'bottom-right'
    }
    const hasSplitSlots = Object.values(saved ?? {}).some((side) => side === 'left-bottom' || side === 'right-bottom')
    if (saved && layoutVersion !== '4' && !hasSplitSlots) migrated.Structure = 'left-bottom'
    return migrated
  } catch { return defaultToolSides }
}

export function IdePage() {
  const params = new URLSearchParams(getAppLocation().search)
  const projectId = params.get('project') ?? 'aurora-dashboard'
  const provider = params.get('provider') === 'drive' ? 'drive' : 'local'
  const hasProvider = params.has('provider')
  const [project, setProject] = useState<ProjectWorkspace | ReturnType<typeof createSampleProject>>(() => hasProvider
    ? { id: projectId, name: projectId, provider, files: new MemoryFileSystem(projectId) }
    : createSampleProject(projectId))
  const [workspaceError, setWorkspaceError] = useState('')
  const [tabs, setTabs] = useState<OpenTab[]>([])
  const [activePath, setActivePath] = useState('')
  const [panel, setPanel] = useState<Panel>(() => toolWindows.find((tool) => readToolSides()[tool] === 'bottom') ?? 'Problems')
  const [toolSides, setToolSides] = useState<Record<ToolWindow, DockSide>>(readToolSides)
  const [toolOrder, setToolOrder] = useState<ToolWindow[]>(readToolOrder)
  const [draggedTool, setDraggedTool] = useState<ToolWindow | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [activeLeftTool, setActiveLeftTool] = useState<ToolWindow>(() => toolWindows.find((tool) => readToolSides()[tool] === 'left') ?? 'Project')
  const [activeLeftBottomTool, setActiveLeftBottomTool] = useState<ToolWindow>(() => toolWindows.find((tool) => readToolSides()[tool] === 'left-bottom') ?? 'Structure')
  const [activeRightTool, setActiveRightTool] = useState<ToolWindow>(() => toolWindows.find((tool) => readToolSides()[tool] === 'right') ?? 'Debug')
  const [activeRightBottomTool, setActiveRightBottomTool] = useState<ToolWindow>(() => toolWindows.find((tool) => readToolSides()[tool] === 'right-bottom') ?? 'Run')
  const [leftOpen, setLeftOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'left'))
  const [leftBottomOpen, setLeftBottomOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'left-bottom'))
  const [rightOpen, setRightOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'right'))
  const [rightBottomOpen, setRightBottomOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'right-bottom'))
  const [bottomOpen, setBottomOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'bottom'))
  const [activeBottomRightTool, setActiveBottomRightTool] = useState<ToolWindow>(() => toolWindows.find((tool) => readToolSides()[tool] === 'bottom-right') ?? 'Debug')
  const [bottomRightOpen, setBottomRightOpen] = useState(() => toolWindows.some((tool) => readToolSides()[tool] === 'bottom-right'))
  const [sidebarWidth, setSidebarWidth] = useState(252)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(260)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(190)
  const [bottomSplitWidth, setBottomSplitWidth] = useState(0.5)
  const [leftSplitHeight, setLeftSplitHeight] = useState(0.62)
  const [rightSplitHeight, setRightSplitHeight] = useState(0.62)
  const [dialog, setDialog] = useState<'search' | 'new' | 'folder' | 'actions' | null>(null)
  const [query, setQuery] = useState('')
  const [creationParent, setCreationParent] = useState('')
  const [menu, setMenu] = useState<string | null>(null)
  const [runConfigMenuOpen, setRunConfigMenuOpen] = useState(false)
  const [runConfigDialogOpen, setRunConfigDialogOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [saveStates, setSaveStates] = useState<Record<string, 'saved' | 'saving' | 'error'>>({})
  const openingPaths = useRef(new Set<string>())
  const projectKeyRef = useRef(project.id)
  const mountedRef = useRef(true)
  const toggleToolWindowRef = useRef<(tool: ToolWindow) => void>(() => undefined)
  const saveAllFilesRef = useRef<() => void>(() => undefined)
  const saveTimers = useRef(new Map<string, number>())
  const pendingSaves = useRef(new Map<string, { file: VirtualFile; text: string }>())
  const latestTextByPath = useRef(new Map<string, string>())
  const saveQueues = useRef(new Map<string, Promise<void>>())
  const [selection, setSelection] = useState({ key: '', index: 0 })
  const [caretStatus, setCaretStatus] = useState({ path: '', offset: 0 })
  const lastShiftPress = useRef(0)

  const tabsRef = useRef(tabs)
  useEffect(() => { tabsRef.current = tabs }, [tabs])
  const disposeOpenTabs = useCallback(() => {
    for (const tab of tabsRef.current) { tab.editor.dispose(); tab.document.dispose() }
  }, [])
  const flushPendingSaves = useCallback(() => {
    for (const timer of saveTimers.current.values()) window.clearTimeout(timer)
    saveTimers.current.clear()
    for (const [saveKey, { file, text }] of pendingSaves.current) {
      const previous = saveQueues.current.get(saveKey) ?? Promise.resolve()
      const queued = previous.catch(() => undefined)
        .then(() => Promise.resolve(file.write?.(text)))
        .then(() => undefined)
      saveQueues.current.set(saveKey, queued)
      // Cleanup paths cannot await; attach a handler while preserving the rejection
      // on the queue so an explicit project-navigation flush can detect failures.
      void queued.catch(() => undefined)
    }
    pendingSaves.current.clear()
  }, [])
  const active = tabs.find((tab) => tab.file.path === activePath)
  const saveStateKey = active ? `${project.id}:${active.file.path}` : ''
  const saveState = active ? saveStates[saveStateKey] ?? 'saved' : 'saved'
  const setFileSaveState = (key: string, state: 'saved' | 'saving' | 'error') => setSaveStates((current) => ({ ...current, [key]: state }))
  const queueFileSave = useCallback((saveKey: string, file: VirtualFile, text: string, failureMessage: string) => {
    const previous = saveQueues.current.get(saveKey) ?? Promise.resolve()
    const queued = previous.catch(() => undefined)
      .then(() => Promise.resolve(file.write?.(text)))
      .then(() => undefined)
    saveQueues.current.set(saveKey, queued)
    void queued.then(() => {
      if (saveQueues.current.get(saveKey) === queued && !pendingSaves.current.has(saveKey)) {
        if (latestTextByPath.current.get(saveKey) === text) latestTextByPath.current.delete(saveKey)
        if (mountedRef.current && saveKey.startsWith(`${projectKeyRef.current}:`)) {
          setSaveStates((current) => ({ ...current, [saveKey]: 'saved' }))
        }
      }
    }).catch((cause: unknown) => {
      if (mountedRef.current && saveKey.startsWith(`${projectKeyRef.current}:`) && saveQueues.current.get(saveKey) === queued) {
        setSaveStates((current) => ({ ...current, [saveKey]: 'error' }))
        setNotice(cause instanceof Error ? cause.message : failureMessage)
      }
    })
    return queued
  }, [setNotice])
  const flushAllOpenFiles = useCallback(() => {
    const writableTabs = tabsRef.current.filter((tab) => tab.file.write)
    if (writableTabs.length === 0) { setNotice('There are no writable files open.'); return }
    const saves = writableTabs.map((tab) => {
      const saveKey = `${project.id}:${tab.file.path}`
      const timer = saveTimers.current.get(saveKey)
      if (timer !== undefined) window.clearTimeout(timer)
      saveTimers.current.delete(saveKey)
      pendingSaves.current.delete(saveKey)
      setSaveStates((current) => ({ ...current, [saveKey]: 'saving' }))
      const queued = queueFileSave(saveKey, tab.file, tab.document.text, provider === 'drive' ? 'Could not save to Google Drive.' : 'Could not save this file.')
      return { saveKey, queued }
    })
    void Promise.all(saves.map(({ queued }) => queued)).then(() => {
      const allStillCurrent = saves.every(({ saveKey, queued }) => saveQueues.current.get(saveKey) === queued && !pendingSaves.current.has(saveKey))
      if (mountedRef.current && projectKeyRef.current === project.id && allStillCurrent) setNotice('All open files saved.')
    }).catch(() => undefined)
  }, [project.id, provider, queueFileSave, setNotice])
  const navigateToProjects = useCallback(async () => {
    const saveKeys = new Set(pendingSaves.current.keys())
    for (const tab of tabsRef.current) if (tab.file.write) saveKeys.add(`${projectKeyRef.current}:${tab.file.path}`)
    flushPendingSaves()
    if (tabsRef.current.some((tab) => tab.file.write)) flushAllOpenFiles()
    const saves = [...saveKeys].map((key) => saveQueues.current.get(key)).filter((save): save is Promise<void> => Boolean(save))
    try {
      await Promise.all(saves)
      navigateApp('/')
    } catch {
      if (mountedRef.current) setNotice('Could not save every file. Stay in the project and retry before leaving.')
    }
  }, [flushAllOpenFiles, flushPendingSaves, setNotice])
  useEffect(() => { saveAllFilesRef.current = flushAllOpenFiles }, [flushAllOpenFiles])
  useEffect(() => {
    try {
      localStorage.setItem('webrains.tool-window-layout', JSON.stringify(toolSides))
      localStorage.setItem('webrains.tool-window-layout-version', '4')
    } catch { /* Layout remains usable for this session if storage is blocked. */ }
  }, [toolSides])
  useEffect(() => {
    try { localStorage.setItem('webrains.tool-window-order', JSON.stringify(toolOrder)) } catch { /* Icon order remains usable for this session if storage is blocked. */ }
  }, [toolOrder])
  const setSlotOpen = (side: DockSide, open: boolean) => {
    if (side === 'left') setLeftOpen(open)
    else if (side === 'left-bottom') setLeftBottomOpen(open)
    else if (side === 'right') setRightOpen(open)
    else if (side === 'right-bottom') setRightBottomOpen(open)
    else if (side === 'bottom-right') setBottomRightOpen(open)
    else setBottomOpen(open)
  }
  const setSlotActive = (side: DockSide, tool: ToolWindow) => {
    if (side === 'left') setActiveLeftTool(tool)
    else if (side === 'left-bottom') setActiveLeftBottomTool(tool)
    else if (side === 'right') setActiveRightTool(tool)
    else if (side === 'right-bottom') setActiveRightBottomTool(tool)
    else if (side === 'bottom-right') setActiveBottomRightTool(tool)
    else setPanel(tool)
  }
  const activeToolForSide = (side: DockSide) => side === 'left' ? activeLeftTool : side === 'left-bottom' ? activeLeftBottomTool : side === 'right' ? activeRightTool : side === 'right-bottom' ? activeRightBottomTool : side === 'bottom-right' ? activeBottomRightTool : panel
  const isSideOpen = (side: DockSide) => side === 'left' ? leftOpen : side === 'left-bottom' ? leftBottomOpen : side === 'right' ? rightOpen : side === 'right-bottom' ? rightBottomOpen : side === 'bottom-right' ? bottomRightOpen : bottomOpen
  const moveToolWindow = (tool: ToolWindow, side: DockSide) => {
    const previousSide = toolSides[tool]
    if (previousSide === side) {
      setSlotActive(side, tool)
      setSlotOpen(side, true)
      return
    }
    const nextSides = { ...toolSides, [tool]: side }
    setToolSides(nextSides)
    if (isSideOpen(previousSide) && activeToolForSide(previousSide) === tool) {
      const replacement = toolOrder.find((candidate) => candidate !== tool && nextSides[candidate] === previousSide)
      if (replacement) setSlotActive(previousSide, replacement)
      else setSlotOpen(previousSide, false)
    }
    setSlotActive(side, tool)
    setSlotOpen(side, true)
  }
  const showToolWindow = (tool: ToolWindow) => {
    const side = toolSides[tool]
    setSlotActive(side, tool)
    setSlotOpen(side, true)
  }
  const toggleToolWindow = (tool: ToolWindow) => {
    const side = toolSides[tool]
    if (isSideOpen(side) && activeToolForSide(side) === tool) setSlotOpen(side, false)
    else showToolWindow(tool)
  }
  useEffect(() => {
    toggleToolWindowRef.current = toggleToolWindow
  })
  const beginToolDrag = (event: React.DragEvent<HTMLElement>, tool: ToolWindow) => {
    // Keep the native source in its original layout throughout dragstart; changing
    // its position or visibility during this event can cancel native browser DnD.
    setDraggedTool(tool)
    setDragPreview(null)
    event.dataTransfer.setData('application/x-webrains-tool-window', tool)
    event.dataTransfer.setData('text/plain', tool)
    event.dataTransfer.effectAllowed = 'move'
  }
  const beginHeaderDrag = (event: React.DragEvent<HTMLDivElement>, tool: ToolWindow) => {
    if ((event.target as HTMLElement).closest('button')) { event.preventDefault(); return }
    beginToolDrag(event, tool)
  }
  const previewToolDrop = (event: React.DragEvent<HTMLElement>, side: DockSide, targetTool: ToolWindow | null = null) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    if (!draggedTool) return
    const hoveredButton = (event.target as HTMLElement).closest<HTMLElement>('[data-tool-window]')
    const hoveredTool = targetTool ?? hoveredButton?.dataset.toolWindow as ToolWindow | undefined
    const target = hoveredTool && hoveredTool !== draggedTool ? hoveredTool : null
    const tools = toolOrder.filter((tool) => toolSides[tool] === side && tool !== draggedTool)
    const targetIndex = target ? tools.indexOf(target) : -1
    const bounds = target && hoveredButton ? hoveredButton.getBoundingClientRect() : null
    const horizontal = side === 'bottom' || side === 'bottom-right'
    const insertAfter = bounds && (horizontal ? event.clientX >= bounds.left + bounds.width / 2 : event.clientY >= bounds.top + bounds.height / 2)
    const insertAt = targetIndex < 0 ? tools.length : targetIndex + (insertAfter ? 1 : 0)
    const beforeTool = tools[insertAt] ?? null
    setDragPreview((current) => current?.side === side && current.beforeTool === beforeTool ? current : { side, beforeTool })
  }
  const stripeDropSide = (
    event: React.DragEvent<HTMLElement>,
    topSide: DockSide,
    lowerSide: DockSide,
    bottomSide: DockSide,
  ): DockSide => {
    const group = (event.target as HTMLElement).closest<HTMLElement>('.stripe-drop-group')
    if (group?.getAttribute('aria-label')?.startsWith('Bottom')) return bottomSide
    if (group?.getAttribute('aria-label')?.includes('top tool windows')) return topSide
    // The divider and the flexible empty area belong to the lower side group.
    return lowerSide
  }
  const renderStripeButtons = (side: DockSide, activeTool: ToolWindow, isOpen: boolean) => {
    const groupTools = toolOrder.filter((tool) => toolSides[tool] === side)
    const visibleTools = groupTools.filter((tool) => tool !== draggedTool)
    const insertionIndex = dragPreview?.side === side
      ? dragPreview.beforeTool ? visibleTools.indexOf(dragPreview.beforeTool) : visibleTools.length
      : -1
    const placeholder = <div key="drag-preview" className="stripe-drag-placeholder" aria-label="Drop position preview"><ToolIcon tool={draggedTool!} /></div>
    const renderButton = (tool: ToolWindow, hidden = false) => <button key={tool} data-tool-window={tool} draggable onDragStart={(event) => beginToolDrag(event, tool)} onDragEnd={() => { setDraggedTool(null); setDragPreview(null); clearDockDropTargets() }} onDragOver={(event) => previewToolDrop(event, side, tool)} onDrop={(event) => dropToolWindow(event, side, tool)} className={`${isOpen && activeTool === tool ? 'stripe-active' : ''}${hidden ? ' stripe-drag-source' : ''}`} type="button" title={tool} aria-label={`${tool} tool window`} onClick={() => toggleToolWindow(tool)}><ToolIcon tool={tool} /></button>
    const children: React.ReactNode[] = []
    let visibleIndex = 0
    let placeholderInserted = false
    for (const tool of groupTools) {
      if (!placeholderInserted && visibleIndex === insertionIndex && draggedTool && dragPreview?.side === side) {
        children.push(placeholder)
        placeholderInserted = true
      }
      children.push(renderButton(tool, Boolean(dragPreview && tool === draggedTool)))
      if (tool !== draggedTool) visibleIndex += 1
    }
    if (!placeholderInserted && visibleIndex === insertionIndex && draggedTool && dragPreview?.side === side) children.push(placeholder)
    return <>{children}</>
  }
  const dropOnStripeGroup = (event: React.DragEvent<HTMLElement>, emptySide: DockSide) => {
    // A dragged icon remains in the DOM. Exclude it so a one-icon group cannot drop onto itself.
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-tool-window]')]
      .filter((button) => button.dataset.toolWindow !== draggedTool)
    if (!buttons.length) {
      dropToolWindow(event, emptySide)
      return
    }
    const target = buttons.reduce((closest, button) => {
      const horizontal = emptySide === 'bottom' || emptySide === 'bottom-right'
      const bounds = button.getBoundingClientRect()
      const closestBounds = closest.getBoundingClientRect()
      const pointer = horizontal ? event.clientX : event.clientY
      const distance = Math.abs(pointer - (horizontal ? bounds.left + bounds.width / 2 : bounds.top + bounds.height / 2))
      const closestDistance = Math.abs(pointer - (horizontal ? closestBounds.left + closestBounds.width / 2 : closestBounds.top + closestBounds.height / 2))
      return distance < closestDistance ? button : closest
    })
    const targetTool = target.dataset.toolWindow as ToolWindow
    // Drop into the group, not the target icon's previous dock. A lower-stripe icon
    // can currently open in the bottom row, but the lower side group is a distinct dock.
    dropToolWindow(event, emptySide, targetTool)
  }
  const clearDockDropTargets = () => {
    document.querySelectorAll<HTMLElement>('.dock-drop-target').forEach((element) => element.classList.remove('dock-drop-target'))
  }
  const dropToolWindow = (event: React.DragEvent<HTMLElement>, side: DockSide, targetTool?: ToolWindow) => {
    event.preventDefault()
    event.stopPropagation()
    clearDockDropTargets()
    const dragged = event.dataTransfer.getData('application/x-webrains-tool-window') || event.dataTransfer.getData('text/plain')
    if (!toolWindows.includes(dragged as ToolWindow) || targetTool === dragged) return
    const tool = dragged as ToolWindow
    setDraggedTool(null)
    setDragPreview(null)
    let destination = side
    const droppedOnPanel = event.currentTarget.classList.contains('side-tool-pane')
    if (droppedOnPanel && !targetTool && (side === 'left' || side === 'left-bottom')) {
      const hasUpper = leftOpen && toolSides[activeLeftTool] === 'left'
      const hasLower = leftBottomOpen && toolSides[activeLeftBottomTool] === 'left-bottom'
      if (!(hasUpper && hasLower)) {
        const bounds = event.currentTarget.getBoundingClientRect()
        destination = event.clientY >= bounds.top + bounds.height / 2 ? 'left-bottom' : 'left'
      }
    } else if (droppedOnPanel && !targetTool && (side === 'right' || side === 'right-bottom')) {
      const hasUpper = rightOpen && toolSides[activeRightTool] === 'right'
      const hasLower = rightBottomOpen && toolSides[activeRightBottomTool] === 'right-bottom'
      if (!(hasUpper && hasLower)) {
        const bounds = event.currentTarget.getBoundingClientRect()
        destination = event.clientY >= bounds.top + bounds.height / 2 ? 'right-bottom' : 'right'
      }
    }
    const targetElement = targetTool
      ? (event.currentTarget as HTMLElement).matches('[data-tool-window]') && (event.currentTarget as HTMLElement).dataset.toolWindow === targetTool
        ? event.currentTarget as HTMLElement
        : [...event.currentTarget.querySelectorAll<HTMLElement>('[data-tool-window]')].find((element) => element.dataset.toolWindow === targetTool) ?? null
      : null
    const bounds = targetElement?.getBoundingClientRect() ?? null
    const horizontal = destination === 'bottom' || destination === 'bottom-right'
    const insertBeforeTarget = bounds !== null && (horizontal ? event.clientX < bounds.left + bounds.width / 2 : event.clientY < bounds.top + bounds.height / 2)
    setToolOrder((current) => {
      const next = current.filter((candidate) => candidate !== tool)
      let insertionIndex = next.length
      if (targetTool) {
        const targetIndex = next.indexOf(targetTool)
        if (targetIndex >= 0) insertionIndex = targetIndex + (insertBeforeTarget ? 0 : 1)
      } else {
        const lastInGroup = [...next].reverse().find((candidate) => toolSides[candidate] === destination)
        if (lastInGroup) insertionIndex = next.indexOf(lastInGroup) + 1
      }
      next.splice(insertionIndex, 0, tool)
      return next
    })
    moveToolWindow(tool, destination)
  }
  const renderToolPanel = (options: {
    tool: ToolWindow
    side: DockSide
    kind: 'side' | 'bottom'
    className: string
    style?: React.CSSProperties
    ariaLabel: string
    hideLabel: string
    onHide: () => void
    children: React.ReactNode
  }) => {
    const { tool, side, kind, className, style, ariaLabel, hideLabel, onHide, children } = options
    const isBottom = kind === 'bottom'
    return <section className={className} style={style} aria-label={ariaLabel}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; event.currentTarget.classList.add('dock-drop-target') }}
      onDragLeave={(event) => event.currentTarget.classList.remove('dock-drop-target')}
      onDrop={(event) => dropToolWindow(event, side)}>
      {isBottom && <div className="bottom-resize-handle" role="separator" aria-orientation="horizontal" aria-label={`Resize ${ariaLabel}`} onPointerDown={startBottomResize} />}
      <div className={isBottom ? 'bottom-panel-header' : 'panel-heading'} draggable
        onDragStart={(event) => beginHeaderDrag(event, tool)}
        onDragEnd={() => { setDraggedTool(null); setDragPreview(null); clearDockDropTargets() }}
        title={isBottom ? 'Drag this header to dock the tool window' : 'Drag this header to move the tool window'}>
        {isBottom && <ToolIcon tool={tool} />}
        {isBottom ? <strong>{tool}</strong> : <span>{tool}</span>}
        {isBottom && tool === 'Problems' && <span className="problem-count">0</span>}
        {isBottom && <div className="bottom-fill" />}
        <button className={isBottom ? 'panel-collapse' : undefined} type="button" aria-label={hideLabel} title="Hide tool window" onClick={onHide}><img src={`${import.meta.env.BASE_URL}icons/intellij/hide.svg`} alt="" aria-hidden="true" /></button>
      </div>
      {children}
    </section>
  }

  const openFile = useCallback((file: VirtualFile) => {
    const requestedProjectKey = project.id
    const openingKey = `${requestedProjectKey}:${file.path}`
    setActivePath(file.path)
    if (tabsRef.current.some((tab) => tab.file.path === file.path)) return
    if (openingPaths.current.has(openingKey)) return
    openingPaths.current.add(openingKey)
    const latestText = latestTextByPath.current.get(openingKey) ?? pendingSaves.current.get(openingKey)?.text
    const readText = latestText === undefined ? file.readText() : Promise.resolve(latestText)
    void readText.then((text) => {
      if (!mountedRef.current || projectKeyRef.current !== requestedProjectKey) return
      setTabs((current) => {
        if (!mountedRef.current || projectKeyRef.current !== requestedProjectKey || current.some((tab) => tab.file.path === file.path)) return current
        const document = new DocumentModel(text)
        return [...current, { file, document, editor: new EditorModel(document) }]
      })
    }).catch((cause: unknown) => {
      if (mountedRef.current && projectKeyRef.current === requestedProjectKey) setNotice(cause instanceof Error ? cause.message : `Could not open ${file.name}.`)
    }).finally(() => openingPaths.current.delete(openingKey))
  }, [project.id, setNotice])

  useEffect(() => {
    let cancelled = false
    if (!hasProvider) return
    void openWorkspace(provider, projectId).then((workspace) => {
      if (!cancelled) {
        projectKeyRef.current = workspace.id
        disposeOpenTabs()
        setProject(workspace)
        setTabs([])
        setActivePath('')
        setWorkspaceError('')
      }
    }).catch((cause: unknown) => {
      if (!cancelled) {
        projectKeyRef.current = '__workspace_error__'
        disposeOpenTabs()
        setTabs([])
        setActivePath('')
        setWorkspaceError(cause instanceof Error ? cause.message : 'Could not open this project.')
      }
    })
    return () => { cancelled = true }
  }, [disposeOpenTabs, hasProvider, projectId, provider])

  useEffect(() => {
    if (hasProvider && (!('provider' in project) || project.provider !== provider)) return
    const first = project.files.find('src/App.tsx') ?? project.files.find('main.py') ?? project.files.find('README.md') ?? project.files.root.children().find((entry) => !entry.isDirectory)
    if (first && !first.isDirectory) queueMicrotask(() => openFile(first))
  }, [hasProvider, openFile, project, provider])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      flushPendingSaves()
      disposeOpenTabs()
    }
  }, [disposeOpenTabs, flushPendingSaves])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      if (event.key === 'Escape') { setDialog(null); setMenu(null); setRunConfigMenuOpen(false); setRunConfigDialogOpen(false); return }
      if (event.target instanceof HTMLInputElement && event.target.closest('.quick-dialog')) return
      if (event.key === 'Shift' && !event.repeat) {
        const now = Date.now()
        if (now - lastShiftPress.current < 400) {
          event.preventDefault()
          setDialog('search')
          setQuery('')
        }
        lastShiftPress.current = now
      }
      if (mod && event.shiftKey && key === 'n') { event.preventDefault(); setDialog('search'); setQuery('') }
      if (mod && key === 'p') { event.preventDefault(); setNotice('Parameter info is not implemented yet.') }
      if (mod && key === 'f') { event.preventDefault(); setNotice(event.shiftKey ? 'Find in files is not implemented yet.' : 'Find in file is not implemented yet.') }
      if (event.altKey && event.key === 'Insert') { event.preventDefault(); setCreationParent(''); setDialog('new'); setQuery('') }
      if (mod && event.altKey && key === 's') { event.preventDefault(); setNotice('IDE settings are not implemented yet.') }
      if (mod && !event.altKey && !event.shiftKey && key === 's') { event.preventDefault(); saveAllFilesRef.current() }
      if (mod && event.shiftKey && key === 'a') { event.preventDefault(); setDialog('actions'); setQuery('') }
      if (mod && event.shiftKey && key === 'f12') {
        event.preventDefault()
        setLeftOpen(false); setLeftBottomOpen(false); setRightOpen(false); setRightBottomOpen(false); setBottomOpen(false)
      }
      if (event.shiftKey && (event.key === 'F10' || event.key === 'F9')) { event.preventDefault(); setRunConfigMenuOpen(true) }
      if (event.altKey && event.key === '1') { event.preventDefault(); toggleToolWindowRef.current('Project') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const updateText = (text: string) => {
    if (!active) return
    const previousText = active.document.text
    let startOffset = 0
    while (startOffset < previousText.length && startOffset < text.length && previousText[startOffset] === text[startOffset]) startOffset += 1
    let previousEnd = previousText.length
    let nextEnd = text.length
    while (previousEnd > startOffset && nextEnd > startOffset && previousText[previousEnd - 1] === text[nextEnd - 1]) {
      previousEnd -= 1
      nextEnd -= 1
    }
    if (startOffset !== previousEnd || startOffset !== nextEnd) {
      active.document.replace({ startOffset, endOffset: previousEnd }, text.slice(startOffset, nextEnd))
    }
    if (active.file.write) {
      const saveKey = `${project.id}:${active.file.path}`
      latestTextByPath.current.set(saveKey, text)
      setFileSaveState(saveKey, 'saving')
      const previousTimer = saveTimers.current.get(saveKey)
      if (previousTimer !== undefined) window.clearTimeout(previousTimer)
      pendingSaves.current.set(saveKey, { file: active.file, text })
      // BrowserFS AsyncMirror queues IndexedDB writes; coalesce keystrokes instead of
      // adding one durable-backend operation per character. Drive needs a longer debounce.
      const debounceMs = provider === 'drive' ? 450 : 180
      const failureMessage = provider === 'drive' ? 'Could not save to Google Drive.' : 'Could not save this file.'
      const timer = window.setTimeout(() => {
        saveTimers.current.delete(saveKey)
        const pending = pendingSaves.current.get(saveKey)
        if (!pending) return
        pendingSaves.current.delete(saveKey)
        void queueFileSave(saveKey, pending.file, pending.text, failureMessage)
      }, debounceMs)
      saveTimers.current.set(saveKey, timer)
    }
    setTabs((current) => [...current])
  }

  const makeFile = async (name: string) => {
    const fileName = name.trim().replace(/^\/+/, '')
    if (!fileName) return
    if (fileName.includes('/')) { setNotice('Enter only a file name, without a path.'); return }
    const clean = [creationParent, fileName].filter(Boolean).join('/')
    if (isLikelyBinaryFileName(fileName)) { setNotice('Binary assets cannot be created or edited as text in WebBrains yet.'); return }
    if (clean.endsWith('/')) { setNotice('Enter a file name after the final slash.'); return }
    const existing = project.files.find(clean)
    if (existing) { setNotice(`An entry already exists at ${clean}. Choose a different file name.`); return }
    const extension = clean.split('.').at(-1)?.toLowerCase()
    const initialText = extension === 'py' || extension === 'toml' || extension === 'yaml' || extension === 'yml'
      ? '# Start writing here\n'
      : extension === 'md'
        ? '# New document\n'
        : extension === 'json'
          ? '{}\n'
          : extension === 'css'
            ? '/* Start writing here */\n'
            : ['js', 'jsx', 'ts', 'tsx'].includes(extension ?? '')
              ? '// Start writing here\n'
              : ''
    try {
      const file = await project.files.writeText(clean, initialText)
      setDialog(null)
      openFile(file)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Could not create this file.')
    }
  }

  const makeFolder = async (name: string) => {
    const folderName = name.trim().replace(/^\/+|\/+$/g, '')
    if (!folderName) { setNotice('Enter a directory name.'); return }
    if (folderName.includes('/')) { setNotice('Enter only a directory name, without a path.'); return }
    const clean = [creationParent, folderName].filter(Boolean).join('/')
    if (project.files.find(clean)) { setNotice(`An entry already exists at ${clean}.`); return }
    try { await project.files.createDirectory(clean); setDialog(null); setNotice(`Created directory ${clean}.`) }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'Could not create this directory.') }
  }
  const treeCreateFile = (parent: string) => {
    const rootPath = project.files.root.path
    setCreationParent(parent === rootPath ? '' : parent.startsWith(`${rootPath}/`) ? parent.slice(rootPath.length + 1) : '')
    setQuery('')
    setDialog('new')
  }
  const treeCreateFolder = (parent: string) => {
    const rootPath = project.files.root.path
    setCreationParent(parent === rootPath ? '' : parent.startsWith(`${rootPath}/`) ? parent.slice(rootPath.length + 1) : '')
    setQuery('')
    setDialog('folder')
  }
  const treeDeleteEntry = async (path: string) => {
    if (!path || path === project.files.root.path) throw new Error('The project root cannot be deleted from the project tree.')
    const prefix = `${path}/`
    const affected = tabsRef.current.filter((tab) => tab.file.path === path || tab.file.path.startsWith(prefix))
    for (const tab of affected) {
      const saveKey = `${project.id}:${tab.file.path}`
      const timer = saveTimers.current.get(saveKey)
      if (timer !== undefined) window.clearTimeout(timer)
      saveTimers.current.delete(saveKey)
      pendingSaves.current.delete(saveKey)
      latestTextByPath.current.delete(saveKey)
    }
    await Promise.all(affected.map((tab) => saveQueues.current.get(`${project.id}:${tab.file.path}`)?.catch(() => undefined)))
    await project.files.deleteEntry(path)
    for (const tab of affected) { tab.editor.dispose(); tab.document.dispose() }
    setTabs((current) => current.filter((tab) => tab.file.path !== path && !tab.file.path.startsWith(prefix)))
    if (activePath === path || activePath.startsWith(prefix)) setActivePath('')
    setNotice(`Deleted ${path.split('/').at(-1) ?? path}.`)
  }

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.max(180, Math.min(440, startWidth + moveEvent.clientX - startX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const startRightResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = rightSidebarWidth
    const move = (moveEvent: PointerEvent) => setRightSidebarWidth(Math.max(180, Math.min(440, startWidth + startX - moveEvent.clientX)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const startBottomResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const startY = event.clientY
    const startHeight = bottomPanelHeight
    const move = (moveEvent: PointerEvent) => setBottomPanelHeight(Math.max(100, Math.min(window.innerHeight * 0.65, startHeight + startY - moveEvent.clientY)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const startBottomSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const move = (moveEvent: PointerEvent) => setBottomSplitWidth(Math.max(0.2, Math.min(0.8, (moveEvent.clientX - bounds.left) / bounds.width)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const startLeftSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const move = (moveEvent: PointerEvent) => setLeftSplitHeight(Math.max(0.25, Math.min(0.8, (moveEvent.clientY - bounds.top) / bounds.height)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }
  const startRightSplitResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect()
    if (!bounds) return
    const move = (moveEvent: PointerEvent) => setRightSplitHeight(Math.max(0.25, Math.min(0.8, (moveEvent.clientY - bounds.top) / bounds.height)))
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const files = (() => {
    const all: VirtualFile[] = []
    const visit = (directory: import('../platform/core/vfs.ts').VirtualDirectory) => directory.children().forEach((entry) => entry.isDirectory ? visit(entry as import('../platform/core/vfs.ts').VirtualDirectory) : all.push(entry))
    visit(project.files.root)
    return all
  })()
  const searchResults = files.filter((file) => `${file.name} ${file.path}`.toLowerCase().includes(query.toLowerCase()))
  const actionItems = [
    { label: 'Search files', shortcut: 'Ctrl+Shift+N', run: () => { setDialog('search'); setQuery('') } },
    { label: 'Find in project', shortcut: 'Ctrl+Shift+F', run: () => setNotice('Find in files is not implemented yet.') },
    { label: 'New file', shortcut: 'Alt+Insert', run: () => { setCreationParent(''); setDialog('new'); setQuery('') } },
    { label: 'Toggle project tool window', shortcut: 'Alt+1', run: () => toggleToolWindow('Project') },
    { label: 'Open terminal panel', shortcut: '', run: () => showToolWindow('Terminal') },
  ].filter((action) => action.label.toLowerCase().includes(query.toLowerCase()))
  const menuCommandsFor = (item: string) => {
    const notImplemented = (feature: string) => () => setNotice(`${feature} is not implemented in the browser-only runtime yet.`)
    switch (item) {
      case 'File': return [
        { label: 'New', shortcut: 'Alt+Insert', run: () => { setCreationParent(''); setDialog('new'); setQuery('') } },
        { label: 'Open Recent', shortcut: '', run: notImplemented('Open Recent') },
        { label: 'Save All', shortcut: 'Ctrl+S', run: () => undefined },
        { label: 'Close Project', shortcut: '', run: () => undefined },
      ]
      case 'Edit': return [
        { label: 'Undo', shortcut: 'Ctrl+Z', run: notImplemented('Undo') },
        { label: 'Redo', shortcut: 'Ctrl+Shift+Z', run: notImplemented('Redo') },
        { label: 'Find in Files', shortcut: 'Ctrl+Shift+F', run: notImplemented('Find in files') },
        { label: 'Select All', shortcut: 'Ctrl+A', run: () => document.querySelector<HTMLTextAreaElement>('.code-input')?.select() },
      ]
      case 'View': return [
        { label: 'Tool Windows', shortcut: '', run: () => { const open = leftOpen || leftBottomOpen || rightOpen || rightBottomOpen || bottomOpen || bottomRightOpen; setLeftOpen(!open); setLeftBottomOpen(!open); setRightOpen(!open); setRightBottomOpen(!open); setBottomOpen(!open); setBottomRightOpen(!open) } },
        { label: 'Appearance', shortcut: '', run: notImplemented('Appearance settings') },
        { label: 'Enter Distraction Free Mode', shortcut: '', run: notImplemented('Distraction Free Mode') },
      ]
      case 'Navigate': return [
        { label: 'Search Files', shortcut: 'Shift Shift', run: () => { setDialog('search'); setQuery('') } },
        { label: 'File', shortcut: 'Ctrl+Shift+N', run: () => { setDialog('search'); setQuery('') } },
        { label: 'Declaration', shortcut: 'Ctrl+B', run: notImplemented('Go to Declaration') },
      ]
      case 'Code': return [
        { label: 'Reformat Code', shortcut: 'Ctrl+Alt+L', run: notImplemented('Code reformatting') },
        { label: 'Generate', shortcut: 'Alt+Insert', run: notImplemented('Code generation') },
        { label: 'Inspect Code', shortcut: '', run: notImplemented('Code inspection') },
      ]
      case 'Refactor': return [
        { label: 'Rename', shortcut: 'Shift+F6', run: notImplemented('Rename refactoring') },
        { label: 'Move', shortcut: 'F6', run: notImplemented('Move refactoring') },
        { label: 'Extract Method', shortcut: 'Ctrl+Alt+M', run: notImplemented('Extract Method') },
      ]
      case 'Build': return [
        { label: 'Build Project', shortcut: 'Ctrl+F9', run: notImplemented('Project builds') },
        { label: 'Rebuild Project', shortcut: '', run: notImplemented('Project rebuilds') },
      ]
      case 'Run': return [
        { label: 'Run…', shortcut: 'Alt+Shift+F10', run: () => setRunConfigMenuOpen(true) },
        { label: 'Debug…', shortcut: 'Alt+Shift+F9', run: () => setRunConfigMenuOpen(true) },
        { label: 'Edit Configurations…', shortcut: '', run: () => setRunConfigMenuOpen(true) },
      ]
      case 'Tools': return [
        { label: 'Terminal', shortcut: '', run: () => showToolWindow('Terminal') },
        { label: 'Settings', shortcut: 'Ctrl+Alt+S', run: notImplemented('IDE settings') },
      ]
      case 'VCS': return [
        { label: 'Commit', shortcut: 'Ctrl+K', run: notImplemented('Version control commits') },
        { label: 'Update Project', shortcut: 'Ctrl+T', run: notImplemented('Version control updates') },
        { label: 'Git Branches', shortcut: '', run: notImplemented('Git branch management') },
      ]
      case 'Window': return [
        { label: 'Hide All Tool Windows', shortcut: 'Ctrl+Shift+F12', run: () => { setLeftOpen(false); setLeftBottomOpen(false); setRightOpen(false); setRightBottomOpen(false); setBottomOpen(false) } },
        { label: 'Project Tool Window', shortcut: 'Alt+1', run: () => showToolWindow('Project') },
      ]
      default: return [{ label: 'WebBrains Help', shortcut: '', run: notImplemented('Help') }, { label: 'About', shortcut: '', run: () => setNotice('WebBrains — browser-only IntelliJ-style IDE experiment.') }]
    }
  }
  const dialogResults = dialog === 'actions' ? actionItems : searchResults
  const showRightTopPanel = rightOpen && toolSides[activeRightTool] === 'right'
  const showRightBottomPanel = rightBottomOpen && toolSides[activeRightBottomTool] === 'right-bottom'
  const showLeftColumn = leftOpen && toolSides[activeLeftTool] === 'left' || leftBottomOpen && toolSides[activeLeftBottomTool] === 'left-bottom'
  const showRightColumn = showRightTopPanel || showRightBottomPanel
  const selectionKey = `${dialog ?? ''}:${query}`
  const selectedResult = selection.key === selectionKey ? selection.index : 0
  const moveDialogSelection = (direction: -1 | 1) => {
    if (!dialogResults.length) return
    setSelection({ key: selectionKey, index: (selectedResult + direction + dialogResults.length) % dialogResults.length })
  }
  const chooseDialogResult = () => {
    if (dialog === 'new') { void makeFile(query); return }
    if (dialog === 'folder') { void makeFolder(query); return }
    if (dialog === 'actions') {
      const action = actionItems[selectedResult]
      if (action) {
        action.run()
        if (!['Search files', 'New file'].includes(action.label)) setDialog(null)
      }
      return
    }
    const file = searchResults[selectedResult]
    if (file) { openFile(file); setDialog(null) }
  }

  if (workspaceError && hasProvider) return <main className="route-fallback" role="alert"><span className="brand-mark">W</span><h1>Could not open project</h1><p>{workspaceError}</p><a className="primary-button" href={appUrl('/')}>Back to projects</a></main>

  const selectedRunConfiguration: string | null = null

  return <main className="ide-shell" onClick={() => { if (menu) setMenu(null); if (runConfigMenuOpen) setRunConfigMenuOpen(false) }}>
    <header className="ide-topbar">
      <a href={appUrl('/')} className="ide-brand" aria-label="WebBrains projects" onClick={(event) => { event.preventDefault(); void navigateToProjects() }}><span className="brand-mark ide-brand-mark">IJ</span></a>
      <button type="button" className="project-switcher" aria-label={`Back to projects from ${project.name}`} title="Back to projects" onClick={() => { void navigateToProjects() }}><span className="project-switch-icon idea-project-icon" style={projectIconStyle(project.id)} aria-hidden="true">{projectInitials(project.name)}</span><strong>{project.name}</strong></button>
      <nav className="menu-bar" aria-label="Main menu">{['File', 'Edit', 'View', 'Navigate', 'Code', 'Refactor', 'Build', 'Run', 'Tools', 'VCS', 'Window', 'Help'].map((item) => <div className="menu-wrap" key={item}><button type="button" className="menu-item" aria-expanded={menu === item} onClick={(event) => { event.stopPropagation(); setMenu(menu === item ? null : item) }}>{item}</button>{menu === item && <div className="menu-popover">{menuCommandsFor(item).map((command) => <button key={command.label} type="button" onClick={() => { if (command.label === 'Save All') flushAllOpenFiles(); else if (command.label === 'Close Project') void navigateToProjects(); else command.run(); setMenu(null) }}><span>{command.label}</span><small>{command.shortcut}</small></button>)}</div>}</div>)}</nav>
      <div className="topbar-spacer" />
      <div className="run-config-wrap">
        <button className="run-config" type="button" aria-haspopup="menu" aria-expanded={runConfigMenuOpen} onClick={(event) => { event.stopPropagation(); setRunConfigMenuOpen((open) => !open); setMenu(null) }}><span className="run-config-icon">◇</span><span>{selectedRunConfiguration ?? 'Add Configuration…'}</span><span className="run-config-chevron">⌄</span></button>
        {runConfigMenuOpen && <div className="run-config-menu" role="menu" aria-label="Run configurations" onClick={(event) => event.stopPropagation()}>
          <div className="run-config-empty">No run configurations available</div>
          <div className="run-config-menu-divider" />
          <button type="button" role="menuitem" onClick={() => { setRunConfigMenuOpen(false); setRunConfigDialogOpen(true) }}>Edit Configurations…</button>
        </div>}
      </div>
      <button className="toolbar-icon run-button" aria-label="Run" title="Run" type="button" disabled={!selectedRunConfiguration} onClick={() => { if (selectedRunConfiguration) showToolWindow('Run') }}><img src={`${import.meta.env.BASE_URL}icons/intellij/run-action.svg`} alt="" aria-hidden="true" /></button>
      <button className="toolbar-icon debug-button" aria-label="Debug" title="Debug" type="button" disabled={!selectedRunConfiguration} onClick={() => { if (selectedRunConfiguration) showToolWindow('Debug') }}><img src={`${import.meta.env.BASE_URL}icons/intellij/debug-action.svg`} alt="" aria-hidden="true" /></button>
      <button className="toolbar-icon" aria-label="Search files" title="Search files (Shift Shift or Ctrl+Shift+N)" type="button" onClick={() => setDialog('search')}><img src={`${import.meta.env.BASE_URL}icons/intellij/search.svg`} alt="" aria-hidden="true" /></button>
    </header>
    {workspaceError && <div className="workspace-error" role="alert">Could not open project: {workspaceError} <a href={appUrl('/')}>Back to projects</a></div>}
    <div className={`ide-workbench${workspaceError ? ' has-workspace-error' : ''}`}>
      <aside className="tool-stripe" aria-label="Left tool windows"
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          event.currentTarget.classList.add('dock-drop-target')
          previewToolDrop(event, stripeDropSide(event, 'left', 'left-bottom', 'bottom'))
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove('dock-drop-target')}
        onDrop={(event) => dropToolWindow(event, stripeDropSide(event, 'left', 'left-bottom', 'bottom'))}>
        <div className="stripe-drop-group stripe-top-tools" aria-label="Left top tool windows" onDragOver={(event) => previewToolDrop(event, 'left')} onDrop={(event) => dropOnStripeGroup(event, 'left')}>
          {renderStripeButtons('left', activeLeftTool, leftOpen)}
        </div>
        <div className="stripe-bottom-divider" aria-label="Dock to lower side tool windows" onDragOver={(event) => previewToolDrop(event, 'left-bottom')} onDrop={(event) => dropToolWindow(event, 'left-bottom')} />
        <div className="stripe-drop-group stripe-lower-side-tools" aria-label="Left lower side tool windows" onDragOver={(event) => previewToolDrop(event, 'left-bottom')} onDrop={(event) => dropOnStripeGroup(event, 'left-bottom')}>
          {renderStripeButtons('left-bottom', activeLeftBottomTool, leftBottomOpen)}
        </div>
        <div className="stripe-spacer" />
        <div className="stripe-drop-group stripe-bottom-panel-tools" aria-label="Bottom panel tool windows" onDragOver={(event) => previewToolDrop(event, 'bottom')} onDrop={(event) => dropOnStripeGroup(event, 'bottom')}>
          {renderStripeButtons('bottom', panel, bottomOpen)}
        </div>
      </aside>
      <aside className="right-tool-stripe" aria-label="Right tool windows"
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
          event.currentTarget.classList.add('dock-drop-target')
          previewToolDrop(event, stripeDropSide(event, 'right', 'right-bottom', 'bottom-right'))
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove('dock-drop-target')}
        onDrop={(event) => dropToolWindow(event, stripeDropSide(event, 'right', 'right-bottom', 'bottom-right'))}>
        <div className="stripe-drop-group stripe-top-tools" aria-label="Right top tool windows" onDragOver={(event) => previewToolDrop(event, 'right')} onDrop={(event) => dropOnStripeGroup(event, 'right')}>
          {renderStripeButtons('right', activeRightTool, rightOpen)}
        </div>
        <div className="stripe-bottom-divider" aria-label="Dock to lower side tool windows" onDragOver={(event) => previewToolDrop(event, 'right-bottom')} onDrop={(event) => dropToolWindow(event, 'right-bottom')} />
        <div className="stripe-drop-group stripe-lower-side-tools" aria-label="Right lower side tool windows" onDragOver={(event) => previewToolDrop(event, 'right-bottom')} onDrop={(event) => dropOnStripeGroup(event, 'right-bottom')}>
          {renderStripeButtons('right-bottom', activeRightBottomTool, rightBottomOpen)}
        </div>
        <div className="stripe-spacer" />
        <div className="stripe-drop-group stripe-bottom-panel-tools" aria-label="Bottom-right panel tool windows" onDragOver={(event) => previewToolDrop(event, 'bottom-right')} onDrop={(event) => dropOnStripeGroup(event, 'bottom-right')}>
          {renderStripeButtons('bottom-right', activeBottomRightTool, bottomRightOpen)}
        </div>
      </aside>
      <div className="ide-main-row">

      {showLeftColumn && <aside className="side-tool-column left-tool-column" style={{ width: sidebarWidth }}>
        {leftOpen && toolSides[activeLeftTool] === 'left' && renderToolPanel({ tool: activeLeftTool, side: 'left', kind: 'side', className: 'project-panel side-tool-pane', style: { flex: leftBottomOpen && toolSides[activeLeftBottomTool] === 'left-bottom' ? `${leftSplitHeight} 1 0` : '1 1 0' }, ariaLabel: 'Left tool window', hideLabel: 'Hide left tool window', onHide: () => setLeftOpen(false), children: activeLeftTool === 'Project' ? <><ProjectTree root={project.files.root} rootName={project.name} onOpen={openFile} onCreateFile={treeCreateFile} onCreateFolder={treeCreateFolder} onDelete={treeDeleteEntry} /><div className="project-panel-foot">{provider === 'drive' ? 'Google Drive' : params.has('provider') ? 'BrowserFS · IndexedDB' : 'Demo project'}</div></> : <div className="bottom-content"><ToolWindowContent tool={activeLeftTool} /></div> })}
        {leftOpen && leftBottomOpen && toolSides[activeLeftTool] === 'left' && toolSides[activeLeftBottomTool] === 'left-bottom' && <div className="side-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize left tool window split" onPointerDown={startLeftSplitResize} />}
        {leftBottomOpen && toolSides[activeLeftBottomTool] === 'left-bottom' && renderToolPanel({ tool: activeLeftBottomTool, side: 'left-bottom', kind: 'side', className: 'project-panel side-tool-pane side-tool-pane-lower', style: { flex: leftOpen && toolSides[activeLeftTool] === 'left' ? `${1 - leftSplitHeight} 1 0` : '1 1 0' }, ariaLabel: 'Lower left tool window', hideLabel: 'Hide lower left tool window', onHide: () => setLeftBottomOpen(false), children: activeLeftBottomTool === 'Project' ? <ProjectTree root={project.files.root} rootName={project.name} onOpen={openFile} onCreateFile={treeCreateFile} onCreateFolder={treeCreateFolder} onDelete={treeDeleteEntry} /> : <div className="bottom-content"><ToolWindowContent tool={activeLeftBottomTool} /></div> })}
      </aside>}
      {showLeftColumn && <div className="resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize left tool window" onPointerDown={startResize} />}
      <section className="editor-area" aria-label="Editor workspace">
        <div className="tabs-row">{tabs.map((tab) => <div role="tab" aria-selected={activePath === tab.file.path} tabIndex={0} className={`editor-tab${activePath === tab.file.path ? ' active' : ''}`} key={tab.file.path} onClick={() => setActivePath(tab.file.path)} onKeyDown={(event) => { if (event.key === 'Enter') setActivePath(tab.file.path) }}><span className="tab-type">{tab.file.name.endsWith('.py') ? 'Py' : tab.file.name.endsWith('.tsx') || tab.file.name.endsWith('.ts') ? 'TS' : tab.file.name.endsWith('.css') ? '#' : tab.file.name.endsWith('.md') ? 'MD' : '◇'}</span><span>{tab.file.name}</span><button type="button" aria-label={`Close ${tab.file.name}`} onClick={(event) => { event.stopPropagation(); const rest = tabs.filter((candidate) => candidate !== tab); tab.editor.dispose(); tab.document.dispose(); setTabs(rest); if (activePath === tab.file.path) setActivePath(rest.at(-1)?.file.path ?? '') }}>{'×'}</button></div>)}<button className="new-tab" type="button" aria-label="Create new file" onClick={() => { setCreationParent(''); setQuery(''); setDialog('new') }}>＋</button><div className="tabs-fill" /><button className="toolbar-icon tab-search" type="button" aria-label="Search files" onClick={() => setDialog('search')}><img src={`${import.meta.env.BASE_URL}icons/intellij/search.svg`} alt="" aria-hidden="true" /></button></div>
        {active ? <><div className="breadcrumbs"><span>{project.name}</span><span>›</span><span>{active.file.path.split('/').slice(-2, -1)[0]}</span><span>›</span><strong>{active.file.name}</strong></div><CodeEditor filePath={active.file.path} value={active.document.text} onChange={updateText} onCaretChange={(offset) => { active.editor.setCaretOffset(offset); setCaretStatus({ path: active.file.path, offset }) }} /><div className="editor-hint">{active.file.name.endsWith('.py') ? 'Python' : active.file.name.endsWith('.tsx') ? 'TypeScript JSX' : active.file.name.endsWith('.ts') ? 'TypeScript' : active.file.name.endsWith('.css') ? 'CSS' : active.file.name.endsWith('.md') ? 'Markdown' : 'Text'} <span>·</span> UTF-8 <span>·</span> LF</div></> : <div className="empty-editor"><span className="brand-mark">W</span><p>Open a file from the Project panel</p><kbd>Shift Shift</kbd><span>Search files</span></div>}

      </section>
      {showRightColumn && <div className="resize-handle resize-handle-right" role="separator" aria-orientation="vertical" aria-label="Resize right tool window" onPointerDown={startRightResize} />}
      {showRightColumn && <aside className="side-tool-column right-tool-column" style={{ width: rightSidebarWidth }}>
        {showRightTopPanel && renderToolPanel({ tool: activeRightTool, side: 'right', kind: 'side', className: 'right-tool-panel side-tool-pane', style: { flex: showRightBottomPanel ? `${rightSplitHeight} 1 0` : '1 1 0' }, ariaLabel: 'Right tool window', hideLabel: 'Hide right tool window', onHide: () => setRightOpen(false), children: activeRightTool === 'Project' ? <ProjectTree root={project.files.root} rootName={project.name} onOpen={openFile} onCreateFile={treeCreateFile} onCreateFolder={treeCreateFolder} onDelete={treeDeleteEntry} /> : <div className="bottom-content"><ToolWindowContent tool={activeRightTool} /></div> })}
        {showRightTopPanel && showRightBottomPanel && <div className="side-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize right tool window split" onPointerDown={startRightSplitResize} />}
        {showRightBottomPanel && renderToolPanel({ tool: activeRightBottomTool, side: 'right-bottom', kind: 'side', className: 'right-tool-panel side-tool-pane side-tool-pane-lower', style: { flex: showRightTopPanel ? `${1 - rightSplitHeight} 1 0` : '1 1 0' }, ariaLabel: 'Lower right tool window', hideLabel: 'Hide lower right tool window', onHide: () => setRightBottomOpen(false), children: <div className="bottom-content"><ToolWindowContent tool={activeRightBottomTool} /></div> })}
      </aside>}

      </div>
      {(bottomOpen || bottomRightOpen) && <div className="bottom-panels-row" style={{ height: bottomPanelHeight }}>
        {bottomOpen && renderToolPanel({ tool: panel, side: 'bottom', kind: 'bottom', className: 'bottom-panel dock-drop-zone', style: { flex: bottomRightOpen ? `${bottomSplitWidth} 1 0` : '1 1 0' }, ariaLabel: 'Bottom-left tool window', hideLabel: 'Hide bottom tool window', onHide: () => setBottomOpen(false), children: <div className="bottom-content">{panel === 'Project' ? <div className="bottom-project-tree"><ProjectTree root={project.files.root} rootName={project.name} onOpen={openFile} onCreateFile={treeCreateFile} onCreateFolder={treeCreateFolder} onDelete={treeDeleteEntry} /></div> : <ToolWindowContent tool={panel} />}</div> })}
        {bottomOpen && bottomRightOpen && <div className="bottom-side-splitter" role="separator" aria-orientation="vertical" aria-label="Resize bottom tool-window split" onPointerDown={startBottomSplitResize} />}
        {bottomRightOpen && renderToolPanel({ tool: activeBottomRightTool, side: 'bottom-right', kind: 'bottom', className: 'bottom-panel bottom-panel-right dock-drop-zone', style: { flex: bottomOpen ? `${1 - bottomSplitWidth} 1 0` : '0 0 50%' }, ariaLabel: 'Bottom-right tool window', hideLabel: 'Hide bottom-right tool window', onHide: () => setBottomRightOpen(false), children: <div className="bottom-content"><ToolWindowContent tool={activeBottomRightTool} /></div> })}
      </div>}
    </div>
    <footer className="status-bar">
      <div>
        <span className="status-branch">⑂</span>
        <span>{provider === 'drive' ? 'Google Drive' : 'Local'}</span>
        <span className="status-separator">|</span>
        <span>WebBrains</span>
      </div>
      <div className="status-right">
        <span>{saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        <span>{active ? (() => {
          const caretOffset = caretStatus.path === active.file.path ? caretStatus.offset : active.editor.caretOffset
          const before = active.document.text.slice(0, caretOffset)
          const line = before.split('\n')
          return `Ln ${line.length}, Col ${line.at(-1)!.length + 1}`
        })() : 'No file selected'}</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
        <span>{active?.file.name.endsWith('.py') ? 'Python' : active?.file.name.endsWith('.css') ? 'CSS' : active?.file.name.endsWith('.json') ? 'JSON' : active?.file.name.endsWith('.md') ? 'Markdown' : active?.file.name.endsWith('.toml') ? 'TOML' : 'TypeScript'}</span>
        <span className="status-check">✓</span>
      </div>
    </footer>
    {notice && <div role="status" className="toast-notice">{notice}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
    {runConfigDialogOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRunConfigDialogOpen(false) }}><section className="quick-dialog run-config-dialog" role="dialog" aria-modal="true" aria-labelledby="run-config-dialog-title"><div className="run-config-dialog-heading"><strong id="run-config-dialog-title">Run/Debug Configurations</strong><button type="button" aria-label="Close configurations" onClick={() => setRunConfigDialogOpen(false)}>×</button></div><div className="run-config-dialog-empty">No configuration types are available yet. Plugins can contribute run/debug configuration types.</div><div className="run-config-dialog-actions"><button type="button" onClick={() => setRunConfigDialogOpen(false)}>Close</button></div></section></div>}
    {dialog && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialog(null) }}><section className="quick-dialog" role="dialog" aria-modal="true" aria-label={dialog === 'new' ? 'New file' : dialog === 'folder' ? 'New directory' : dialog === 'actions' ? 'Find action' : 'Search files'}><div className="quick-input-row"><span>{dialog === 'new' || dialog === 'folder' ? '＋' : dialog === 'actions' ? '⌘' : '⌕'}</span><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={dialog === 'new' ? 'File name' : dialog === 'folder' ? 'Directory name' : dialog === 'actions' ? 'Type an action name' : 'Search files by name…'} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); moveDialogSelection(1) } else if (event.key === 'ArrowUp') { event.preventDefault(); moveDialogSelection(-1) } else if (event.key === 'Enter') { event.preventDefault(); chooseDialogResult() } }} /></div>{dialog === 'new' || dialog === 'folder' ? <div className="dialog-help">{dialog === 'new' ? 'A new file will be created in the current project.' : 'A new directory will be created in the current project.'}</div> : <div className="quick-results">{dialog === 'actions' ? actionItems.map((action, index) => <button key={action.label} className={selectedResult === index ? 'result-active' : ''} type="button" onMouseEnter={() => setSelection({ key: selectionKey, index })} onClick={() => { action.run(); if (!['Search files', 'New file'].includes(action.label)) setDialog(null) }}><span className="file-type type-other">⌘</span><span>{action.label}</span><small>{action.shortcut}</small></button>) : searchResults.map((file, index) => <button key={file.path} className={selectedResult === index ? 'result-active' : ''} type="button" onMouseEnter={() => setSelection({ key: selectionKey, index })} onClick={() => { openFile(file); setDialog(null) }}><span className="file-type type-ts">{file.name.endsWith('.tsx') || file.name.endsWith('.ts') ? 'TS' : '◇'}</span><span>{file.name}</span><small>{file.path}</small></button>)}{dialog === 'actions' && actionItems.length === 0 && <p>No matching actions</p>}{dialog === 'search' && searchResults.length === 0 && <p>No matching files</p>}</div>}<div className="dialog-footer"><span>↑↓ to navigate</span><span>Enter to open</span><span>Esc to close</span></div></section></div>}
  </main>
}
