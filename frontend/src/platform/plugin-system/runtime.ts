import { ActionSystem } from '../core/actions.ts'
import { EditorKeyHandlerRegistry } from '../core/editorCommands.ts'
import { EditorCompletionContributorRegistry, EditorLanguageServiceRegistry } from '../core/editorServices.ts'
import { ContributionRegistry } from '../core/extensionApis.ts'
import type { FileTypeContribution, ParserDefinitionContribution, InspectionContribution, IntentionContribution, DocumentationContribution, FormatterContribution, NavigationContribution, LiveTemplateContribution, ToolWindowContribution, SettingsPageContribution, RunLineMarkerContribution } from '../core/extensionApis.ts'
import { ExtensionRegistry } from '../core/extensions.ts'
import { RunConfigurationRegistry } from '../core/execution.ts'
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
  readonly editorCompletionContributors: EditorCompletionContributorRegistry
  readonly editorKeyHandlers: EditorKeyHandlerRegistry
  readonly projectTemplates: ProjectTemplateRegistry
  readonly runConfigurations: RunConfigurationRegistry
  readonly fileTypes: ContributionRegistry<FileTypeContribution>
  readonly parserDefinitions: ContributionRegistry<ParserDefinitionContribution>
  readonly inspections: ContributionRegistry<InspectionContribution>
  readonly intentions: ContributionRegistry<IntentionContribution>
  readonly documentationProviders: ContributionRegistry<DocumentationContribution>
  readonly formatters: ContributionRegistry<FormatterContribution>
  readonly navigators: ContributionRegistry<NavigationContribution>
  readonly liveTemplates: ContributionRegistry<LiveTemplateContribution>
  readonly toolWindows: ContributionRegistry<ToolWindowContribution>
  readonly settingsPages: ContributionRegistry<SettingsPageContribution>
  readonly runLineMarkers: ContributionRegistry<RunLineMarkerContribution>
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
  readonly editorCompletionContributors = new EditorCompletionContributorRegistry()
  readonly editorKeyHandlers = new EditorKeyHandlerRegistry()
  readonly projectTemplates = new ProjectTemplateRegistry()
  readonly runConfigurations = new RunConfigurationRegistry()
  readonly fileTypes = new ContributionRegistry<FileTypeContribution>()
  readonly parserDefinitions = new ContributionRegistry<ParserDefinitionContribution>()
  readonly inspections = new ContributionRegistry<InspectionContribution>()
  readonly intentions = new ContributionRegistry<IntentionContribution>()
  readonly documentationProviders = new ContributionRegistry<DocumentationContribution>()
  readonly formatters = new ContributionRegistry<FormatterContribution>()
  readonly navigators = new ContributionRegistry<NavigationContribution>()
  readonly liveTemplates = new ContributionRegistry<LiveTemplateContribution>()
  readonly toolWindows = new ContributionRegistry<ToolWindowContribution>()
  readonly settingsPages = new ContributionRegistry<SettingsPageContribution>()
  readonly runLineMarkers = new ContributionRegistry<RunLineMarkerContribution>()
  private readonly modules = new Map<string, BrowserPluginModule>()
  private readonly registrations = new Map<string, Disposable>()
  private readonly activeScopes = new Map<string, DisposableScope>()
  private started = false
  private disposed = false
  private availablePlatformModules: ReadonlySet<string> = new Set()

  register(plugin: BrowserPluginModule): Disposable {
    this.assertAvailable()
    const id = plugin.manifest.id.trim()
    if (!id || this.modules.has(id)) throw new Error(`Plugin already registered or invalid: ${id}`)
    const catalogRegistration = this.catalog.register(plugin.manifest)
    this.modules.set(id, plugin)
    const registration = disposable(() => {
      const activeDependents = this.catalog.all().filter((manifest) =>
        manifest.id !== id && this.activeScopes.has(manifest.id) && manifest.dependsOn?.includes(id),
      )
      if (activeDependents.length) {
        throw new Error(`Cannot unregister plugin ${id}; active plugins depend on it: ${activeDependents.map(({ id: dependentId }) => dependentId).join(', ')}`)
      }
      try {
        this.activeScopes.get(id)?.dispose()
      } finally {
        this.activeScopes.delete(id)
        if (this.modules.get(id) === plugin) this.modules.delete(id)
        catalogRegistration.dispose()
        if (this.registrations.get(id) === registration) this.registrations.delete(id)
      }
    })
    this.registrations.set(id, registration)

    // Plugins imported after startup are activated immediately. This lets a bundled addon
    // register completion contributors without racing the editor's first module import.
    if (this.started) {
      try {
        this.activatePlugin(plugin)
      } catch (error) {
        registration.dispose()
        throw error
      }
    }
    return registration
  }

  activateAll(availablePlatformModules: ReadonlySet<string> = new Set()): readonly string[] {
    this.assertAvailable()
    if (this.started) throw new Error('Plugin runtime activation has already been attempted')
    this.started = true
    this.availablePlatformModules = new Set(availablePlatformModules)
    const activated: string[] = []
    try {
      for (const manifest of this.catalog.activationOrder(availablePlatformModules)) {
        const plugin = this.modules.get(manifest.id)
        if (!plugin) throw new Error(`Plugin module is missing: ${manifest.id}`)
        this.activatePlugin(plugin)
        activated.push(manifest.id)
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

  private activatePlugin(plugin: BrowserPluginModule): void {
    const manifest = this.catalog.find(plugin.manifest.id)
    if (!manifest) throw new Error(`Plugin is not registered: ${plugin.manifest.id}`)
    if (this.activeScopes.has(manifest.id)) throw new Error(`Plugin is already active: ${manifest.id}`)
    for (const dependencyId of manifest.dependsOn ?? []) {
      if (!this.activeScopes.has(dependencyId)) {
        throw new Error(`Cannot activate plugin ${manifest.id}: dependency ${dependencyId} is not active`)
      }
    }
    const missingPlatformModules = (manifest.platformModules ?? []).filter((moduleId) => !this.availablePlatformModules.has(moduleId))
    if (missingPlatformModules.length) {
      throw new Error(`Cannot activate plugin ${manifest.id}: unavailable platform modules: ${missingPlatformModules.join(', ')}`)
    }

    const lifetime = new DisposableScope()
    this.activeScopes.set(manifest.id, lifetime)
    try {
      const context: BrowserPluginContext = {
        manifest,
        lifetime,
        services: this.services,
        extensions: this.extensions,
        actions: this.actions,
        messages: this.messages,
        languages: this.languages,
        editorLanguageServices: this.editorLanguageServices,
        editorCompletionContributors: this.editorCompletionContributors,
        editorKeyHandlers: this.editorKeyHandlers,
        projectTemplates: this.projectTemplates,
        runConfigurations: this.runConfigurations,
        fileTypes: this.fileTypes,
        parserDefinitions: this.parserDefinitions,
        inspections: this.inspections,
        intentions: this.intentions,
        documentationProviders: this.documentationProviders,
        formatters: this.formatters,
        navigators: this.navigators,
        liveTemplates: this.liveTemplates,
        toolWindows: this.toolWindows,
        settingsPages: this.settingsPages,
        runLineMarkers: this.runLineMarkers,
        register: (cleanup) => lifetime.add(cleanup),
      }
      const cleanup = plugin.activate(context)
      if (cleanup) lifetime.add(cleanup)
    } catch (error) {
      try {
        lifetime.dispose()
      } finally {
        this.activeScopes.delete(manifest.id)
      }
      throw error
    }
  }

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
    for (const cleanup of [
      () => this.actions.dispose(), () => this.messages.dispose(), () => this.services.dispose(),
      () => this.fileTypes.clear(), () => this.parserDefinitions.clear(), () => this.inspections.clear(),
      () => this.intentions.clear(), () => this.documentationProviders.clear(), () => this.formatters.clear(),
      () => this.navigators.clear(), () => this.liveTemplates.clear(), () => this.toolWindows.clear(),
      () => this.settingsPages.clear(), () => this.runLineMarkers.clear(),
    ]) {
      try { cleanup() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Errors while disposing plugin runtime')
  }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('Plugin runtime is disposed')
  }
}
