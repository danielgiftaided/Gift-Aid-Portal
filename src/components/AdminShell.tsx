import { useState, type ReactNode } from 'react'
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './admin.css'

const sections = [
  { to: '/admin', label: 'Charities', icon: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z' },
  { to: '/admin/insights', label: 'Insights & reporting', icon: 'M3 18l6-7 4 3L21 4 M16 4h5v5' },
  { to: '/admin/pending-charities', label: 'Pending charities', icon: 'M12 8v5l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18' },
  { to: '/admin/donor-matching', label: 'Donor matching', icon: 'M3 7h17l-4-4 M21 17H4l4 4' },
  { to: '/admin/activity-log', label: 'Activity log', icon: 'M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1' },
  { to: '/admin/recognition-package', label: 'HMRC recognition', icon: 'M5 3h14v18H5z M8 12l3 3 5-6' },
]

/** Shared presentation only. Administrator authorization remains in AdminRouteGuard. */
export default function AdminShell({ children }: { children?: ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const charityWorkspace = location.pathname.startsWith('/admin/charities/') || location.pathname.startsWith('/submissions/')
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function signOut() {
    setSigningOut(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      navigate('/admin/login')
    } catch {
      setError('Could not sign out. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }
  return (
    <div className="admin-portal">
      <a className="admin-skip-link" href="#admin-content">Skip to content</a>
      <header className="admin-header">
        <div className="admin-header-inner">
          <Link to="/admin" className="admin-logo" aria-label="Gift Aided Portal admin home">
            gift aided<span>Portal</span>
          </Link>
          <span className="admin-workspace-label">ADMIN WORKSPACE</span>
          <button className="admin-signout" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Log out'}
          </button>
        </div>
        <nav className="admin-navigation" aria-label="Admin navigation">
          {sections.map(({ to, label, icon }) => {
            const selected = to === '/admin'
              ? location.pathname === to || charityWorkspace
              : location.pathname === to || location.pathname.startsWith(`${to}/`)
            return (
              <Link
                key={to}
                to={to}
                aria-current={selected ? 'page' : undefined}
                className={`admin-nav-link${selected ? ' selected' : ''}`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d={icon} />
                </svg>
                {label}
              </Link>
            )
          })}
        </nav>
        {error && <p role="alert" className="admin-signout-error">{error}</p>}
      </header>
      <div id="admin-content" className="admin-content" tabIndex={-1}>
        {children ?? <Outlet />}
      </div>
    </div>
  )
}
