import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_PAGES === 'true' && repositoryName ? `/${repositoryName}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react()],
  // The Pyodide runtime is loaded as an external ESM module from its pinned CDN URL.
  // Keep module workers as ESM so the runtime import is not rewritten to an IIFE global.
  worker: { format: 'es' },
  server: {
    allowedHosts: ['expertcachy.tail181ebb.ts.net'],
  },
})
