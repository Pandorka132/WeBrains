import { useCallback, useEffect, useRef, useState } from 'react'
import {
  connectDrive,
  createDriveProject,
  createLocalProject,
  getConfiguredGoogleClientId,
  isDriveConnected,
  listDriveProjects,
  listLocalProjects,
  type ProjectSummary,
  type ProjectTemplate,
} from '../platform/providers.ts'
import { appUrl } from '../utils/routing.ts'

type Provider = 'local' | 'drive'

function openProject(project: ProjectSummary) {
  const params = new URLSearchParams({ provider: project.provider, project: project.id })
  window.location.assign(appUrl('/ide', `?${params}`))
}

export function LandingPage() {
  const [provider, setProvider] = useState<Provider>('local')
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectName, setProjectName] = useState('')
  const [projectTemplate, setProjectTemplate] = useState<ProjectTemplate>('python')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const clientId = getConfiguredGoogleClientId()
  const [connected, setConnected] = useState(isDriveConnected())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshGeneration = useRef(0)

  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current
    try {
      const entries = provider === 'local'
        ? await listLocalProjects()
        : connected ? await listDriveProjects() : []
      if (generation === refreshGeneration.current) setProjects(entries)
    } catch (cause) {
      if (generation === refreshGeneration.current) {
        setProjects([])
        setError(cause instanceof Error ? cause.message : 'Could not load projects.')
      }
    } finally {
      if (generation === refreshGeneration.current) setLoading(false)
    }
  }, [provider, connected])

  useEffect(() => {
    let cancelled = false
    void Promise.resolve().then(() => { if (!cancelled) void refresh() })
    return () => {
      cancelled = true
      refreshGeneration.current += 1
    }
  }, [refresh])

  const createProject = async () => {
    setBusy(true)
    setError('')
    try {
      const workspace = provider === 'local'
        ? await createLocalProject(projectName, projectTemplate)
        : await createDriveProject(projectName, projectTemplate)
      openProject({ id: workspace.id, name: workspace.name, provider, updatedAt: Date.now() })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create project.')
    } finally { setBusy(false) }
  }

  const authorize = async () => {
    setBusy(true)
    setLoading(true)
    setError('')
    try {
      await connectDrive()
      if (connected) await refresh()
      else setConnected(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google authorization failed.')
      setLoading(false)
    } finally { setBusy(false) }
  }

  return <main className="landing-page">
    <header className="landing-header">
      <a href={appUrl('/')} className="brand"><span>WebBrains</span></a>
      <span className="landing-header-note">Browser IDE <span className="landing-header-separator">/</span> Project chooser</span>
    </header>
    <section className="landing-content">
      <div className="landing-intro">
        <div className="eyebrow"><span className="status-dot" /> YOUR DEVELOPMENT WORKSPACE</div>
        <h1>What are we<br /><span>building today?</span></h1>
        <p>Choose where your projects live. Local projects stay in this browser; Drive projects are read and saved directly in Google Drive.</p>
      </div>

      <div className="provider-picker" role="tablist" aria-label="Project storage provider">
        <button type="button" role="tab" aria-selected={provider === 'local'} className={provider === 'local' ? 'provider-choice selected' : 'provider-choice'} onClick={() => { setLoading(true); setError(''); setProvider('local') }}>
          <span className="provider-choice-icon">▣</span><span><strong>This browser</strong><small>Persistent IndexedDB storage</small></span><span className="provider-radio" />
        </button>
        <button type="button" role="tab" aria-selected={provider === 'drive'} className={provider === 'drive' ? 'provider-choice selected' : 'provider-choice'} onClick={() => { setLoading(true); setError(''); setProvider('drive') }}>
          <span className="provider-choice-icon drive-mark">△</span><span><strong>Google Drive</strong><small>Project files stay in your Drive</small></span><span className="provider-radio" />
        </button>
      </div>

      {provider === 'drive' && <section className="drive-setup" aria-label="Google Drive connection">
        <div className="drive-setup-icon">△</div>
        <div className="drive-setup-copy"><strong>{connected ? 'Google Drive connected' : 'Sign in with Google'}</strong><span>{connected ? 'Projects are stored in WebBrains/projects in your Drive.' : clientId ? 'Authorize WebBrains with your Google account.' : 'Google sign-in needs to be enabled for this deployment.'}</span></div>
        <button type="button" className="secondary-button google-signin-button" disabled={busy} onClick={() => void authorize()}>{busy ? 'Connecting…' : connected ? 'Reconnect Google' : 'Sign in with Google'}<span>↗</span></button>
      </section>}

      <div className="section-heading project-section-heading">
        <div><div className="eyebrow">YOUR PROJECTS</div><h2>{provider === 'local' ? 'This browser' : 'Google Drive'}</h2></div>
        <span className="project-count">{loading ? 'Loading…' : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`}</span>
      </div>
      {provider === 'drive' && !connected
        ? <div className="empty-projects"><span>↗</span><strong>Connect Drive to see your projects</strong><small>Drive project files will never be copied into browser storage.</small></div>
        : loading
          ? <div className="empty-projects"><span className="loading-dot" /><strong>Loading projects…</strong></div>
          : projects.length
            ? <div className="project-list">{projects.map((project, index) => <button type="button" key={project.id} className="saved-project" onClick={() => openProject(project)}>
              <span className={`project-icon saved-project-icon saved-project-${index % 3}`}>{project.provider === 'drive' ? '△' : '◈'}</span>
              <span className="project-info"><strong>{project.name}</strong><small>{project.provider === 'drive' ? 'Google Drive' : 'Stored in this browser'}</small></span>
              <span className="project-updated">{project.updatedAt ? new Date(project.updatedAt).toLocaleDateString() : 'Recently updated'}</span><span className="project-open">›</span>
            </button>)}</div>
            : <div className="empty-projects"><span>＋</span><strong>No projects yet</strong><small>Create a project to start working in WebBrains.</small></div>}

      {error && !createDialogOpen && <div className="landing-error" role="alert">{error}</div>}
      <div className="landing-actions">
        <button type="button" className="secondary-button create-project-button" disabled={provider === 'drive' && !connected} onClick={() => { setError(''); setProjectName('New project'); setProjectTemplate('python'); setCreateDialogOpen(true) }}><span>＋</span> Create project</button>
        <button type="button" className="primary-button" disabled={!projects.length} onClick={() => projects[0] && openProject(projects[0])}>Open recent <span>→</span></button>
      </div>
      {createDialogOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateDialogOpen(false) }}>
        <form className="create-project-dialog create-project-wizard" onSubmit={(event) => { event.preventDefault(); void createProject() }}>
          <header className="wizard-header"><div className="dialog-kicker">NEW PROJECT</div><h2>Create a project</h2><p>Choose a project type and give your workspace a name.</p></header>
          <div className="wizard-body">
            <aside className="wizard-types" aria-label="Project type">
              <div className="wizard-group-label">LANGUAGES</div>
              <button type="button" className="wizard-type selected" aria-pressed="true" onClick={() => setProjectTemplate('python')}>
                <span className="python-logo">Py</span><span><strong>Python</strong><small>Python application</small></span><span className="wizard-radio" />
              </button>
            </aside>
            <section className="wizard-settings">
              <label className="wizard-field"><span>Project name</span><input autoFocus value={projectName} onChange={(event) => setProjectName(event.target.value)} aria-label="Project name" placeholder="My project" /></label>
              <div className="wizard-field"><span>Location</span><div className="wizard-location"><span>{provider === 'local' ? '▣' : '△'}</span><span>{provider === 'local' ? 'This browser · IndexedDB' : 'Google Drive · WebBrains/projects'}</span><small>Managed</small></div></div>
              <div className="wizard-field"><span>Project template</span><div className="template-card"><span className="python-logo">Py</span><span><strong>Python</strong><small>Minimal Python project with main.py and pyproject.toml</small></span><span className="wizard-check">✓</span></div></div>
              <div className="wizard-note"><span>ⓘ</span><span>WebBrains currently creates the project files in your selected storage. Running Python code requires a Python runtime, which is not yet built into the browser IDE.</span></div>
            </section>
          </div>
          {error && <div className="landing-error" role="alert">{error}</div>}
          <div className="create-dialog-actions"><button type="button" className="dialog-cancel" onClick={() => setCreateDialogOpen(false)}>Cancel</button><button className="primary-button" type="submit" disabled={busy || !projectName.trim()}>{busy ? 'Creating…' : 'Create'} <span>→</span></button></div>
        </form>
      </div>}
      <footer className="landing-footer"><span>WebBrains <span className="footer-dot">·</span> Workspace runs in your browser</span><a href="https://www.jetbrains.com/idea/" target="_blank" rel="noreferrer">IntelliJ IDEA inspired <span>↗</span></a></footer>
    </section>
  </main>
}
