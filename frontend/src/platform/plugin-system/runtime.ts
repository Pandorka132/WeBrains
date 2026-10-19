import { ActionSystem } from '../core/actions.ts'
import { EditorKeyHandlerRegistry } from '../core/editorCommands.ts'
import { EditorLanguageServiceRegistry } from '../core/editorServices.ts'
import { ExtensionRegistry } from '../core/extensions.ts'
import { LanguageRegistry } from '../core/language.ts'
import { DisposableScope, disposable } from '../core/lifecycle.ts'
import type { Disposable } from '../core/lifecycle.ts'
import { MessageBus } from '../core/messageBus.ts'
import { ProjectTemplateRegistry } from '../core/projectTemplates.ts'
import { ServiceContainer } from '../core/services.ts'
import { PluginCatalog } from './plugins.ts'
import type { BrowserPluginManifest } from './plugins.ts'

export interface BrowserPluginContext {
  readonly manifest: BrowserPluginManifest
  readonly lifetime: DisposableScope
  readonly services: ServiceContainer
  readonly extensions: ExtensionRegistry
  readonly actions: ActionSystem
  readonly messages: MessageBus
  readonly languages: LanguageRegistry
  readonly editorLanguageServices: EditorLanguageServiceRegistry
  readonly editorKeyHandlers: EditorKeyHandlerRegistry
  readonly projectTemplates: ProjectTemplateRegistry
  register<T extends Disposable | (() => void)>(cleanup: T): T
}

/** A plugin module statically bundled into the browser application. */
export interface BrowserPluginModule {
  readonly manifest: BrowserPluginManifest
  activate(context: BrowserPluginContext): void | Disposable
}

/**
 * Owns plugin lifecycle and shared platform registries. This executes bundled browser modules,
 * not arbitrary IntelliJ JARs or Java/Kotlin bytecode.
 */
export class PluginRuntime implements Disposable {
  readonly catalog = new PluginCatalog()
  readonly services = new ServiceContainer()
  readonly extensions = new ExtensionRegistry()
  readonly actions = new ActionSystem()
  readonly messages = new MessageBus()
  readonly languages = new LanguageRegistry()
  readonly editorLanguageServices = new EditorLanguageServiceRegistry()
  readonly editorKeyHandlers = new EditorKeyHandlerRegistry()
  readonly projectTemplates = new ProjectTemplateRegistry()
  private readonly modules = new Map<string, BrowserPluginModule>()
  private readonly registrations = new Map<string, Disposable>()
  private readonly activeScopes = new Map<string, DisposableScope>()
  private started = false
  private disposed = false

  register(plugin: BrowserPluginModule): Disposable {
    this.assertAvailable()
    if (this.started) throw new Error('Plugins cannot be registered after activation has started')
    const id = plugin.manifest.id.trim()
    if (!id || this.modules.has(id)) throw new Error(`Plugin already registered or invalid: ${id}`)
    const catalogRegistration = this.catalog.register(plugin.manifest)
    this.modules.set(id, plugin)
    this.registrations.set(id, catalogRegistration)
    return disposable(() => {
      if (this.activeScopes.has(id)) throw new Error(`Cannot unregister active plugin: ${id}`)
      if (this.modules.get(id) === plugin) this.modules.delete(id)
      this.registrations.get(id)?.dispose()
      this.registrations.delete(id)
    })
  }

  activateAll(availablePlatformModules: ReadonlySet<string> = new Set()): readonly string[] {
    this.assertAvailable()
    if (this.started) throw new Error('Plugin runtime activation has already been attempted')
    this.started = true
    const activated: string[] = []
    try {
      for (const manifest of this.catalog.activationOrder(availablePlatformModules)) {
        const plugin = this.modules.get(manifest.id)
        if (!plugin) throw new Error(`Plugin module is missing: ${manifest.id}`)
        const lifetime = new DisposableScope()
        const context: BrowserPluginContext = {
          manifest,
          lifetime,
          services: this.services,
          extensions: this.extensions,
          actions: this.actions,
          messages: this.messages,
          languages: this.languages,
          editorLanguageServices: this.editorLanguageServices,
          editorKeyHandlers: this.editorKeyHandlers,
          projectTemplates: this.projectTemplates,
          register: (cleanup) => lifetime.add(cleanup),
        }
        this.activeScopes.set(manifest.id, lifetime)
        activated.push(manifest.id)
        const cleanup = plugin.activate(context)
        if (cleanup) lifetime.add(cleanup)
      }
      return activated
    } catch (error) {
      const cleanupErrors: unknown[] = []
      for (const id of [...activated].reverse()) {
        try { this.activeScopes.get(id)?.dispose() } catch (cleanupError) { cleanupErrors.push(cleanupError) }
        this.activeScopes.delete(id)
      }
      if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Plugin activation failed and cleanup was incomplete')
      throw error
    }
  }

  activePluginIds(): readonly string[] { return [...this.activeScopes.keys()] }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const errors: unknown[] = []
    for (const [id, scope] of [...this.activeScopes.entries()].reverse()) {
      try { scope.dispose() } catch (error) { errors.push(error) }
      this.activeScopes.delete(id)
    }
    for (const registration of [...this.registrations.values()].reverse()) {
      try { registration.dispose() } catch (error) { errors.push(error) }
    }
    this.registrations.clear()
    this.modules.clear()
    for (const cleanup of [() => this.actions.dispose(), () => this.messages.dispose(), () => this.services.dispose()]) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Errors while disposing plugin runtime')
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Plugin runtime is disposed')
  }
}
