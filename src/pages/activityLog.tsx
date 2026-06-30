import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface LogEntry {
  id: string
  created_at: string
  user_email: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: string | null
  success: boolean
}

function Logo() {
  return (
    <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '1.6rem', lineHeight: 1 }}>
      gift aided <span style={{ fontWeight: 400 }}>Portal</span>
    </span>
  )
}

function PageShapes() {
  return (
    <div className="absolute right-0 top-0 pointer-events-none select-none" style={{ zIndex: 0, width: '420px', height: '600px' }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '0 50% 50% 50%' }} />
    </div>
  )
}

const ACTION_LABELS: Record<string, string> = {
  login_success: 'Signed in',
  login_failed: 'Failed login attempt',
  login_blocked_lockout: 'Login blocked (too many failed attempts)',
  charity_invited: 'Charity invited',
  charity_setup_completed: 'Charity setup completed',
  claim_built: 'HMRC claim built',
  claim_sent_to_ets: 'Claim sent to ETS',
  claim_status_checked: 'Claim status checked',
}

function actionBadge(action: string, success: boolean) {
  const label = ACTION_LABELS[action] || action
  const style = success
    ? 'bg-green-100 text-green-700'
    : action === 'login_blocked_lockout'
      ? 'bg-red-100 text-red-700'
      : 'bg-yellow-100 text-yellow-700'
  return <span className={`text-xs font-semibold px-2 py-1 rounded ${style}`}>{label}</span>
}

export default function ActivityLog() {
  const navigate = useNavigate()
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pageSize = 50

  useEffect(() => { loadData() }, [page])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const resp = await fetch(`/api/admin/activityLog?limit=${pageSize}&offset=${page * pageSize}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Failed to load activity log')
      setEntries(json.entries)
      setTotal(json.total)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <div className="flex items-center gap-6">
              <button onClick={() => navigate('/admin/insights')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/admin/pending-charities')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Pending Charities</button>
              <button onClick={() => navigate('/admin/activity-log')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Activity Log</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <h1 className="text-3xl font-bold text-brand-primary">Activity Log</h1>
          <p className="text-gray-400 text-sm mt-1">Security-relevant actions across the portal — logins, claim submissions, and charity onboarding.</p>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-50">
                <thead>
                  <tr className="bg-gray-50/50">
                    {['When', 'User', 'Action', 'Target', 'Details'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {loading ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-300">Loading…</td></tr>
                  ) : entries.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-300">No activity recorded yet</td></tr>
                  ) : entries.map(entry => (
                    <tr key={entry.id} className="hover:bg-brand-surface/40 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {new Date(entry.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{entry.user_email || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{actionBadge(entry.action, entry.success)}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{entry.target_type ? `${entry.target_type}${entry.target_id ? ` · ${entry.target_id}` : ''}` : '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-400 max-w-xs truncate" title={entry.details || ''}>{entry.details || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-50 flex items-center justify-between text-sm">
                <span className="text-gray-400">Page {page + 1} of {totalPages} · {total} total entries</span>
                <div className="flex gap-2">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
                    className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50">
                    Previous
                  </button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                    className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50">
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
