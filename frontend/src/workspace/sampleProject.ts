import { MemoryFileSystem } from '../platform/vfs.ts'

export interface SampleProject {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly files: MemoryFileSystem
}

const sampleProjects = {
  'aurora-dashboard': { name: 'Aurora Dashboard', title: 'Aurora workspace', description: 'React · TypeScript · Browser preview' },
  'northstar-ui': { name: 'Northstar UI Kit', title: 'Northstar components', description: 'Design system · TypeScript' },
  'atlas-notes': { name: 'Atlas Notes', title: 'Atlas notebook', description: 'Web application · JavaScript' },
} as const

export function createSampleProject(projectId: string = 'aurora-dashboard'): SampleProject {
  const selected = sampleProjects[projectId as keyof typeof sampleProjects] ?? sampleProjects['aurora-dashboard']
  const safeId = projectId in sampleProjects ? projectId : 'aurora-dashboard'
  const files = new MemoryFileSystem(safeId)
  files.writeText('src/main.tsx', `import { createRoot } from 'react-dom/client'\nimport { App } from './App'\nimport './styles.css'\n\nconst root = document.getElementById('root')\n\nif (!root) {\n  throw new Error('Root element was not found')\n}\n\ncreateRoot(root).render(<App />)\n`)
  files.writeText('src/App.tsx', `import { useState } from 'react'\n\nexport function App() {\n  const [active, setActive] = useState('Overview')\n\n  return (\n    <main className="dashboard">\n      <header className="dashboard-header">\n        <h1>${selected.title}</h1>\n        <button onClick={() => setActive('Activity')}>\n          View activity\n        </button>\n      </header>\n      <section aria-label="Project summary">\n        <p className="eyebrow">YOUR PROJECT</p>\n        <h2>{active}</h2>\n        <p>Everything is moving in the right direction.</p>\n      </section>\n    </main>\n  )\n}\n`)
  files.writeText('src/styles.css', `:root {\n  font-family: Inter, system-ui, sans-serif;\n  color: #e6edf7;\n  background: #101621;\n}\n\n.dashboard {\n  max-width: 960px;\n  margin: 0 auto;\n  padding: 48px;\n}\n\n.dashboard-header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n}\n`)
  files.writeText('index.html', `<!doctype html>\n<html lang="en">\n  <head><meta charset="UTF-8" /><title>Aurora</title></head>\n  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`)
  files.writeText('package.json', `{"name":"aurora-dashboard","private":true,"version":"0.1.0"}\n`)
  files.writeText('README.md', `# Aurora Dashboard\n\nA small browser UI project used to explore the WebBrains editor.\n`)
  return { id: safeId, name: selected.name, description: selected.description, files }
}

export const projects = [
  { id: 'aurora-dashboard', name: 'Aurora Dashboard', detail: 'React · TypeScript', icon: '✦', updated: 'Opened recently' },
  { id: 'northstar-ui', name: 'Northstar UI Kit', detail: 'Design system · TypeScript', icon: '◈', updated: 'Example project' },
  { id: 'atlas-notes', name: 'Atlas Notes', detail: 'Web application · JavaScript', icon: '▤', updated: 'Example project' },
] as const
