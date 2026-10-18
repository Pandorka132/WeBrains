import { LandingPage } from './pages/LandingPage'
import { IdePage } from './pages/IdePage'
import './App.css'

export default function App() {
  const path = window.location.pathname
  if (path === '/ide' || path === '/ide/') return <IdePage />
  if (path === '/') return <LandingPage />
  return <main className="route-fallback"><span className="brand-mark">W</span><h1>Page not found</h1><p>That WebBrains route does not exist.</p><a className="primary-button" href="/">Return to projects</a></main>
}
