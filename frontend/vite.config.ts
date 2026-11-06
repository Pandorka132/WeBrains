import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_PAGES === 'true' && repositoryName ? `/${repositoryName}/` : '/'
const publicDirectory = resolve(import.meta.dirname, 'public')
const pluginsDirectory = resolve(publicDirectory, 'plugins')

interface GeneratedPluginManifest {
  readonly id: string
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly vendor?: string
  readonly icon?: string
  readonly capabilities: readonly {
    readonly id: string
    readonly description?: string
    readonly entrypoint: string
    readonly assets: readonly string[]
  }[]
}

function discoverBuiltPlugins(): Readonly<Record<string, GeneratedPluginManifest>> {
  if (!existsSync(pluginsDirectory)) return {}

  const discovered: Record<string, GeneratedPluginManifest> = {}
  for (const directoryName of readdirSync(pluginsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const pluginDirectory = resolve(pluginsDirectory, directoryName)
    const manifestPath = resolve(pluginDirectory, 'plugin.json')
    if (!existsSync(manifestPath)) continue

    let manifest: GeneratedPluginManifest
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as GeneratedPluginManifest
    } catch (error) {
      throw new Error(`Invalid plugin manifest ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (typeof manifest.id !== 'string' || !manifest.id
      || typeof manifest.name !== 'string' || !manifest.name
      || typeof manifest.version !== 'string' || !manifest.version
      || !Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0
      || manifest.capabilities.some((capability) =>
        !capability || typeof capability.id !== 'string' || !capability.id
        || typeof capability.entrypoint !== 'string' || !capability.entrypoint
        || !Array.isArray(capability.assets) || capability.assets.length === 0
        || capability.assets.some((asset: unknown) => typeof asset !== 'string' || !asset),
      )) {
      throw new Error(`Plugin manifest is missing required metadata or contains invalid capabilities: ${manifestPath}`)
    }
    if (manifest.id.toLowerCase() !== directoryName.toLowerCase()) {
      throw new Error(`Plugin manifest ID ${manifest.id} does not match its directory ${directoryName}`)
    }

    // A manifest is discoverable only when every declared capability asset exists.
    // This prevents a partially copied or stale plugin directory from being advertised.
    const requiredAssets = manifest.capabilities.flatMap((capability) => capability.assets)
    const missingAssets = requiredAssets.filter((asset) => {
      const assetPath = resolve(pluginDirectory, asset)
      return !asset || (assetPath !== pluginDirectory && !assetPath.startsWith(`${pluginDirectory}${sep}`))
        || !existsSync(assetPath)
    })
    if (missingAssets.length) {
      throw new Error(`Plugin ${manifest.id} has missing or unsafe capability assets: ${missingAssets.join(', ')}`)
    }

    if (manifest.icon) {
      const iconPath = resolve(publicDirectory, manifest.icon)
      if (iconPath !== publicDirectory && !iconPath.startsWith(`${publicDirectory}${sep}`)) {
        throw new Error(`Plugin ${manifest.id} has an unsafe icon path: ${manifest.icon}`)
      }
      if (!existsSync(iconPath)) {
        throw new Error(`Plugin ${manifest.id} icon does not exist: ${manifest.icon}`)
      }
    }
    discovered[manifest.id] = manifest
  }
  return discovered
}

function pluginManifestPlugin(): Plugin {
  return {
    name: 'webrains-plugin-manifests',
    transformIndexHtml() {
      const serializedManifests = JSON.stringify(discoverBuiltPlugins()).replace(/</g, '\\u003c')
      return [{
        tag: 'script',
        children: `globalThis.__WEBRAINS_PLUGIN_MANIFESTS__ = ${serializedManifests};`,
        injectTo: 'head-prepend',
      }]
    },
    configureServer(server) {
      server.watcher.add(publicDirectory)
      const refreshManifests = (file: string) => {
        const absoluteFile = resolve(file)
        if (!absoluteFile.startsWith(`${pluginsDirectory}${sep}`)
          || !absoluteFile.endsWith(`${sep}plugin.json`)) return
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', refreshManifests)
      server.watcher.on('change', refreshManifests)
      server.watcher.on('unlink', refreshManifests)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), pluginManifestPlugin()],
  // The Pyodide runtime is loaded as an external ESM module from its pinned CDN URL.
  // Keep module workers as ESM so the runtime import is not rewritten to an IIFE global.
  worker: { format: 'es' },
  server: {
    allowedHosts: ['expertcachy.tail181ebb.ts.net'],
  },
})
