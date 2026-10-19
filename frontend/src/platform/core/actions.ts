import type { Disposable } from './lifecycle.ts'
import { DisposableScope, disposable } from './lifecycle.ts'

export interface ActionPresentation {
  text: string
  enabled: boolean
  visible: boolean
}

export interface ActionContext {
  readonly projectId?: string
  readonly filePath?: string
  readonly editor?: unknown
}

export interface ActionEvent {
  readonly context: ActionContext
  readonly presentation: ActionPresentation
}

export interface PlatformAction {
  update?(event: ActionEvent): void
  perform(event: ActionEvent): void | Promise<void>
}

export interface KeyStroke {
  readonly key: string
  readonly modifiers?: readonly ('ctrl' | 'alt' | 'shift' | 'meta')[]
}

export class Keymap {
  private readonly bindings = new Map<string, KeyStroke[]>()

  bind(actionId: string, stroke: KeyStroke): Disposable {
    const cleanActionId = actionId.trim()
    const cleanKey = stroke.key.trim()
    if (!cleanActionId || /\s/.test(cleanActionId) || !cleanKey) throw new Error('Action id and shortcut key are required')
    const modifiers = [...new Set(stroke.modifiers ?? [])]
    if (modifiers.some((modifier) => !['ctrl', 'alt', 'shift', 'meta'].includes(modifier))) {
      throw new Error('Shortcut contains an unsupported modifier')
    }
    const normalizedStroke: KeyStroke = { key: cleanKey, modifiers }
    const normalized = normalizeStroke(normalizedStroke)
    const strokes = this.bindings.get(cleanActionId) ?? []
    strokes.push(normalizedStroke)
    this.bindings.set(cleanActionId, strokes)
    return disposable(() => {
      const index = strokes.findIndex((candidate) => normalizeStroke(candidate) === normalized)
      if (index >= 0) strokes.splice(index, 1)
      if (strokes.length === 0) this.bindings.delete(cleanActionId)
    })
  }

  getShortcuts(actionId: string): readonly KeyStroke[] {
    return (this.bindings.get(actionId.trim()) ?? []).map((stroke) => ({
      key: stroke.key,
      modifiers: stroke.modifiers ? [...stroke.modifiers] : undefined,
    }))
  }
}

/** Browser-side action registry and dispatcher; UI rendering is supplied by the host. */
export class ActionSystem {
  private readonly actions = new Map<string, PlatformAction>()
  private readonly lifetime = new DisposableScope()
  readonly keymap = new Keymap()

  register(id: string, action: PlatformAction): Disposable {
    const cleanId = id.trim()
    if (!cleanId || /\s/.test(cleanId)) throw new Error('Action id must be a non-empty token')
    if (this.actions.has(cleanId)) throw new Error(`Action already registered: ${cleanId}`)
    this.actions.set(cleanId, action)
    const registration = disposable(() => this.actions.delete(cleanId))
    this.lifetime.add(registration)
    return registration
  }

  get(id: string): PlatformAction | undefined {
    return this.actions.get(id.trim())
  }

  async perform(id: string, context: ActionContext = {}): Promise<boolean> {
    const cleanId = id.trim()
    const action = this.actions.get(cleanId)
    if (!action) return false
    const event: ActionEvent = {
      context,
      presentation: { text: cleanId, enabled: true, visible: true },
    }
    action.update?.(event)
    if (!event.presentation.enabled || !event.presentation.visible) return false
    await action.perform(event)
    return true
  }

  dispose(): void {
    this.lifetime.dispose()
    this.actions.clear()
  }
}

function normalizeStroke(stroke: KeyStroke): string {
  return `${[...(stroke.modifiers ?? [])].sort().join('+')}+${stroke.key.toLowerCase()}`
}
