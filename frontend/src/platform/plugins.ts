import type { Disposable } from './lifecycle.ts'
import { disposable } from './lifecycle.ts'

/** Host-authored metadata for statically bundled browser plugins.
 * This is not an IntelliJ plugin.xml parser or a binary plugin loader.
 */
export interface BrowserPluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly dependsOn?: readonly string[]
  /** IntelliJ module ids that an adapter for this plugin expects to exist. */
  readonly platformModules?: readonly string[]
}

export interface PluginDependencyIssue {
  readonly pluginId: string
  readonly dependencyId: string
  readonly kind: 'plugin' | 'platform-module'
}

/** Catalog for host-imported plugin modules; it only validates declared metadata. */
export class PluginCatalog {
  private readonly manifests = new Map<string, BrowserPluginManifest>()

  register(manifest: BrowserPluginManifest): Disposable {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error('Plugin id, name, and version are required')
    }
    if (this.manifests.has(manifest.id)) throw new Error(`Plugin already registered: ${manifest.id}`)
    this.manifests.set(manifest.id, manifest)
    return disposable(() => this.manifests.delete(manifest.id))
  }

  find(id: string): BrowserPluginManifest | undefined {
    return this.manifests.get(id)
  }

  all(): readonly BrowserPluginManifest[] {
    return [...this.manifests.values()]
  }

  /** Reports unavailable dependencies without attempting to load or execute code. */
  validate(platformModules: ReadonlySet<string> = new Set()): readonly PluginDependencyIssue[] {
    const issues: PluginDependencyIssue[] = []
    for (const manifest of this.manifests.values()) {
      for (const dependencyId of manifest.dependsOn ?? []) {
        if (!this.manifests.has(dependencyId)) {
          issues.push({ pluginId: manifest.id, dependencyId, kind: 'plugin' })
        }
      }
      for (const dependencyId of manifest.platformModules ?? []) {
        if (!platformModules.has(dependencyId)) {
          issues.push({ pluginId: manifest.id, dependencyId, kind: 'platform-module' })
        }
      }
    }
    return issues
  }

  /** Returns dependency-first order, or throws when dependencies are missing or cyclic. */
  activationOrder(platformModules: ReadonlySet<string> = new Set()): readonly BrowserPluginManifest[] {
    const issues = this.validate(platformModules)
    if (issues.length > 0) {
      const details = issues.map(({ pluginId, dependencyId, kind }) => `${pluginId} -> ${kind}:${dependencyId}`)
      throw new Error(`Unresolved plugin dependencies: ${details.join(', ')}`)
    }

    const ordered: BrowserPluginManifest[] = []
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (id: string): void => {
      if (visited.has(id)) return
      if (visiting.has(id)) throw new Error(`Plugin dependency cycle at ${id}`)
      visiting.add(id)
      const manifest = this.manifests.get(id)!
      for (const dependency of manifest.dependsOn ?? []) visit(dependency)
      visiting.delete(id)
      visited.add(id)
      ordered.push(manifest)
    }
    for (const id of this.manifests.keys()) visit(id)
    return ordered
  }
}
