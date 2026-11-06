import type { BrowserPluginManifest } from '../platform/plugin-system/plugins.ts'

declare global {
  var __WEBRAINS_PLUGIN_MANIFESTS__: Readonly<Record<string, BrowserPluginManifest>> | undefined
}

export {}
