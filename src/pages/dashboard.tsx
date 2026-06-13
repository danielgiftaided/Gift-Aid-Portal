import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate, useLocation } from 'react-router-dom'

interface Submission { id: string; submission_date: string; status: string; amount_claimed: number; number_of_donations: number }

function HeroShapes() {
  return (
    <div className="absolute right-0 top-0 h-full overflow-visible" style={{ width: '420px' }}>
      {/* Exact CSS from giftaided.com */}
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '50%' }} />
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const location = useLocation()
  const [charityName, setCharityName] = useState<string>((location.state as any)?.charityName ?? '')
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
        const { data } = await supabase.from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations')
          .eq('charity_id', meJson.charityId)
          .order('submission_date', { ascending: false })
          .limit(5)
        setSubmissions(data || [])
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
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

  const totalGiftAid = submissions.reduce((s, r) => s + (parseFloat(String(r.amount_claimed)) || 0), 0)

  return (
    <div className="min-h-screen bg-brand-surface">

      {/* Nav — white bar, teal brand name */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <span className="text-lg font-bold text-brand-accent tracking-tight">Gift Aided Portal</span>
          <div className="flex items-center gap-5">
            <button onClick={() => navigate('/profile')}
              className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">
              My Profile
            </button>
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Log Out
            </button>
          </div>
        </div>
      </nav>

      {/* Hero section — cream background with exact shapes from giftaided.com on the right */}
      <div className="relative overflow-hidden bg-brand-surface" style={{ minHeight: '480px' }}>
        <HeroShapes />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center" style={{ minHeight: '480px' }}>
          <div className="max-w-lg">
            <p className="text-brand-accent text-xs font-bold uppercase tracking-widest mb-3">Gift Aid Management</p>
            <h1 className="text-4xl font-bold text-brand-primary leading-snug">
              Welcome,{' '}
              <span className="text-brand-accent">{charityName || '…'}</span>
            </h1>
            <p className="text-gray-400 text-sm mt-3 leading-relaxed">
              View your Gift Aid submission history and track your claims.
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Stat cards */}
        {submissions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Total Donations', value: `£${(totalGiftAid * 4).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-primary' },
              { label: 'Total Gift Aid', value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-accent' },
              { label: 'Total Submissions', value: String(submissions.length), color: 'text-brand-primary' },
              { label: 'Approved', value: String(submissions.filter(s => s.status === 'approved').length), color: 'text-green-600' },
            ].map(c => (
              <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Submissions table */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
            <h2 className="font-semibold text-brand-primary">Recent Submissions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-50">
              <thead>
                <tr className="bg-gray-50/50">
                  {['Date', 'Gift Aid Claimed', 'Donations', 'Status'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-10 text-center text-gray-300">No submissions yet</td></tr>
                ) : submissions.map(s => (
                  <tr key={s.id} className="hover:bg-brand-surface/50 transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-600">{new Date(s.submission_date).toLocaleDateString('en-GB')}</td>
                    <td className="px-6 py-4 text-sm font-bold text-brand-accent">
                      £{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{s.number_of_donations}</td>
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
          <div className="px-6 py-4 border-t border-gray-50">
            <button onClick={() => navigate('/submissions')} className="text-sm font-semibold text-brand-accent hover:underline">
              View all submissions →
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
