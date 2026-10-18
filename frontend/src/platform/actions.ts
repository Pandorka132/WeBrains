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
    const normalized = normalizeStroke(stroke)
    const strokes = this.bindings.get(actionId) ?? []
    strokes.push({ key: stroke.key, modifiers: [...(stroke.modifiers ?? [])] })
    this.bindings.set(actionId, strokes)
    return disposable(() => {
      const index = strokes.findIndex((candidate) => normalizeStroke(candidate) === normalized)
      if (index >= 0) strokes.splice(index, 1)
      if (strokes.length === 0) this.bindings.delete(actionId)
    })
  }

  getShortcuts(actionId: string): readonly KeyStroke[] {
    return [...(this.bindings.get(actionId) ?? [])]
  }
}

/** Browser-side action registry and dispatcher; UI rendering is supplied by the host. */
export class ActionSystem {
  private readonly actions = new Map<string, PlatformAction>()
  private readonly lifetime = new DisposableScope()
  readonly keymap = new Keymap()

  register(id: string, action: PlatformAction): Disposable {
    if (this.actions.has(id)) throw new Error(`Action already registered: ${id}`)
    this.actions.set(id, action)
    const registration = disposable(() => this.actions.delete(id))
    this.lifetime.add(registration)
    return registration
  }

  get(id: string): PlatformAction | undefined {
    return this.actions.get(id)
  }

  async perform(id: string, context: ActionContext = {}): Promise<boolean> {
    const action = this.actions.get(id)
    if (!action) return false
    const event: ActionEvent = {
      context,
      presentation: { text: id, enabled: true, visible: true },
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
