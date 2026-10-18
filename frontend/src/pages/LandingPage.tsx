import { useState } from 'react'
import { projects } from '../workspace/sampleProject'

export function LandingPage() {
  const [selected, setSelected] = useState<string>(projects[0].id)

  return <main className="landing-page">
    <header className="landing-header"><a href="/" className="brand"><span className="brand-mark">W</span><span>WebBrains</span></a><span className="landing-header-note">A workspace for ideas in code</span></header>
    <section className="landing-content">
      <div className="landing-intro"><div className="eyebrow"><span className="status-dot" /> BROWSER IDE · EARLY ACCESS</div><h1>Your projects,<br /><span>ready to build.</span></h1><p>Connect a workspace and pick a project to continue in the WebBrains editor.</p></div>
      <section className="drive-card" aria-labelledby="drive-title"><div className="drive-icon">G</div><div className="drive-copy"><h2 id="drive-title">Google Drive</h2><p>Bring a project from your Drive workspace</p></div><button className="connect-button" type="button" disabled aria-describedby="drive-status">Connect Drive <span>↗</span></button><p id="drive-status" className="connect-note">Google Drive connection is not configured yet. Sign-in and file access are coming later.</p></section>
      <section className="project-section" aria-labelledby="projects-title"><div className="section-heading"><div><span className="eyebrow">YOUR WORKSPACE</span><h2 id="projects-title">Choose a project</h2></div><span className="project-count">{projects.length} projects</span></div>
        <div className="project-list" role="radiogroup" aria-label="Sample projects">{projects.map((project) => <button key={project.id} type="button" role="radio" aria-checked={selected === project.id} className={`project-card${selected === project.id ? ' selected' : ''}`} onClick={() => setSelected(project.id)}><span className={`project-icon project-${project.id}`}>{project.icon}</span><span className="project-info"><strong>{project.name}</strong><small>{project.detail}</small></span><span className="project-updated">{project.updated}</span><span className="radio-indicator" /></button>)}</div>
        <div className="landing-actions"><p><span className="info-icon">i</span> Sample projects run locally in this browser. Drive integration is pending.</p><a className="primary-button" href={`/ide?project=${encodeURIComponent(selected)}`}>Open selected project <span>→</span></a></div>
      </section>
      <footer className="landing-footer"><span>WebBrains <span className="muted">· Browser-first IDE experiment</span></span><a href="/ide">Explore the editor <span>↗</span></a></footer>
    </section>
  </main>
}
