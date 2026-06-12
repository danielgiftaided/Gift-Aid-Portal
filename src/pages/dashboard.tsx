import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, useLocation } from 'react-router-dom'

interface Submission {
  id: string
  submission_date: string
  status: string
  amount_claimed: number
  number_of_donations: number
}

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [charityName, setCharityName] = useState<string>((location.state as any)?.charityName ?? '')
  const [charityId, setCharityId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const meResp = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      const meJson = await meResp.json()
      if (!meResp.ok || !meJson.ok) { navigate('/login'); return }
      if (meJson.charityName) setCharityName(meJson.charityName)
      if (meJson.charityId) {
        setCharityId(meJson.charityId)
        const { data } = await supabase.from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations')
          .eq('charity_id', meJson.charityId).order('submission_date', { ascending: false }).limit(5)
        setSubmissions(data || [])
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const handleLogout = async () => { await supabase.auth.signOut(); navigate('/login') }

  const statusColor = (s: string) => {
    if (s === 'approved') return 'bg-green-100 text-green-800'
    if (s === 'rejected') return 'bg-red-100 text-red-800'
    if (s === 'submitted') return 'bg-blue-100 text-blue-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><div className="text-brand-primary font-medium">Loading…</div></div>

  const totalGiftAid = submissions.reduce((s, r) => s + (parseFloat(String(r.amount_claimed)) || 0), 0)
  const totalDonations = totalGiftAid * 4

  return (
    <div className="min-h-screen bg-brand-surface">
      {/* Block 1 — Navy nav */}
      <nav className="bg-brand-primary">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-accent rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">GA</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Gift Aided Portal</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/profile')}
              className="text-sm text-white/80 hover:text-white px-3 py-1.5 rounded-lg border border-white/20 hover:border-white/40 transition-colors">
              My Profile
            </button>
            <button onClick={handleLogout} className="text-sm text-white/70 hover:text-white transition-colors">
              Log Out
            </button>
          </div>
        </div>
      </nav>

      {/* Block 2 — Teal welcome banner */}
      <div className="bg-brand-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Welcome, {charityName || '…'}</h1>
          <p className="text-white/75 text-sm mt-1">View your Gift Aid submission history and status</p>
        </div>
      </div>

      {/* Block 3 — Cream content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Stat cards */}
        {submissions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Donations', value: `£${totalDonations.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-primary' },
              { label: 'Total Gift Aid', value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-accent' },
              { label: 'Total Submissions', value: String(submissions.length), color: 'text-brand-primary' },
              { label: 'Approved', value: String(submissions.filter(s => s.status === 'approved').length), color: 'text-green-600' },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">{card.label}</div>
                <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Submissions table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-brand-primary/5">
            <h2 className="font-semibold text-brand-primary">Recent Submissions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-100">
              <thead>
                <tr className="bg-gray-50">
                  {['Date', 'Amount', 'Donations', 'Status'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-400">No submissions yet</td></tr>
                ) : submissions.map(s => (
                  <tr key={s.id} className="hover:bg-brand-surface/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-700">{new Date(s.submission_date).toLocaleDateString('en-GB')}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-brand-accent">£{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{s.number_of_donations}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColor(s.status)}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <button onClick={() => navigate('/submissions')} className="text-brand-accent text-sm font-semibold hover:underline">
              View all submissions →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
