import { LandingPage } from './pages/LandingPage'
import { IdePage } from './pages/IdePage'
import { appUrl, getAppLocation } from './utils/routing'
import './App.css'

export default function App() {
  const { pathname } = getAppLocation()
  if (pathname === '/ide' || pathname === '/ide/') return <IdePage />
  if (pathname === '/' || pathname === '') return <LandingPage />
  return <main className="route-fallback"><span className="brand-mark">W</span><h1>Page not found</h1><p>That WebBrains route does not exist.</p><a className="primary-button" href={appUrl('/')}>Return to projects</a></main>
}
