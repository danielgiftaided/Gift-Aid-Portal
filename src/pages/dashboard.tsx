import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, useLocation } from 'react-router-dom'
import { fetchAllRows } from '../utils/fetchAll'

interface Submission {
  id: string
  submission_date: string
  status: string
  hmrc_reference: string | null
  amount_claimed: number
  number_of_donations: number
  tax_year: string
}

const PAGE_SIZE = 10

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

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [charityName, setCharityName] = useState<string>((location.state as any)?.charityName ?? '')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const meResp = await fetch('/api/user/me', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        cache: 'no-store',
      })
      const meJson = await meResp.json()
      if (!meResp.ok || !meJson.ok) { navigate('/login'); return }
      if (meJson.charityName) setCharityName(meJson.charityName)

      if (meJson.charityId) {
        const data = await fetchAllRows<Submission>(() =>
          supabase
            .from('submissions')
            .select('id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year')
            .eq('charity_id', meJson.charityId)
            .order('submission_date', { ascending: false })
        )
        setSubmissions(data)
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const statusColor = (s: string) => {
    if (s === 'approved') return 'bg-green-100 text-green-700'
    if (s === 'rejected') return 'bg-red-100 text-red-700'
    if (s === 'submitted') return 'bg-blue-100 text-blue-700'
    return 'bg-yellow-100 text-yellow-700'
  }

  if (loading) return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center">
      <p className="text-brand-accent font-medium">Loading…</p>
    </div>
  )

  // Stat cards always reflect totals across every submission, not just the
  // current page — pagination only affects what's visible in the table.
  const totalGiftAid = submissions.reduce((s, r) => s + (parseFloat(String(r.amount_claimed)) || 0), 0)
  const totalPages = Math.max(1, Math.ceil(submissions.length / PAGE_SIZE))
  const pageRows = submissions.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>

        <nav className="bg-white border-b border-gray-100">
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <div className="flex items-center gap-5">
              <button onClick={() => navigate('/insights')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/profile')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">My Profile</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-5xl mx-auto px-6 pt-14 pb-8">
          <h1 className="text-4xl font-bold text-brand-primary leading-snug">
            Welcome,{' '}
            <span className="text-brand-accent">{charityName || '…'}</span>
          </h1>
          <p className="text-gray-400 text-sm mt-3 max-w-md">
            View your Gift Aid submission history and track your claims. Click any row to view the donor records for that submission.
          </p>
        </div>

        <div className="max-w-5xl mx-auto px-6 pb-12">

          {/* Stat cards */}
          {submissions.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                { label: 'Total Donations', value: `£${(totalGiftAid * 4).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-primary' },
                { label: 'Total Gift Aid', value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-accent' },
                { label: 'Total Submissions', value: String(submissions.length), color: 'text-brand-primary' },
                { label: 'Approved', value: String(submissions.filter(s => s.status === 'approved').length), color: 'text-green-600' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Submissions table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50">
              <h2 className="font-semibold text-brand-primary">Gift Aid Submissions</h2>
              {submissions.length > 0 && (
                <p className="text-xs text-gray-400 mt-0.5">Click any row to view donor records</p>
              )}
            </div>

            {submissions.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-gray-300 text-base">No submissions yet</p>
                <p className="text-xs text-gray-300 mt-2">Your Gift Aid submissions will appear here once they have been processed.</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-50">
                    <thead>
                      <tr className="bg-gray-50/50">
                        {['Submission Date', 'Tax Year', 'Gift Aid Claimed', 'Donations', 'Status', 'HMRC Reference'].map(h => (
                          <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {pageRows.map(s => (
                        <tr
                          key={s.id}
                          onClick={() => navigate(`/submissions/${s.id}`, { state: { backUrl: '/dashboard' } })}
                          className="hover:bg-brand-surface/50 cursor-pointer transition-colors"
                        >
                          <td className="px-6 py-4 text-sm text-gray-600 whitespace-nowrap">
                            {new Date(s.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}
                          </td>
                          <td className="px-6 py-4 text-sm font-medium text-gray-600 whitespace-nowrap">{s.tax_year}</td>
                          <td className="px-6 py-4 text-sm font-bold text-brand-accent whitespace-nowrap">
                            £{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">{s.number_of_donations} donation{s.number_of_donations !== 1 ? 's' : ''}</td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColor(s.status)}`}>
                              {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm text-gray-400 font-mono whitespace-nowrap">{s.hmrc_reference || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between text-sm">
                    <span className="text-gray-400">
                      Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, submissions.length)} of {submissions.length} submissions
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={page === 0}
                        className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={page >= totalPages - 1}
                        className="px-3 py-1 rounded border border-gray-200 text-gray-500 disabled:opacity-40 hover:bg-gray-50 transition-colors"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
