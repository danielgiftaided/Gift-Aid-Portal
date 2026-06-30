import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface CharityBreakdown { name: string; giftAid: number; submissions: number }

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

export default function AdminInsights() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalCharities, setTotalCharities] = useState(0)
  const [totalSubmissions, setTotalSubmissions] = useState(0)
  const [totalGiftAidClaimed, setTotalGiftAidClaimed] = useState(0)
  const [totalDonations, setTotalDonations] = useState(0)
  const [totalApproved, setTotalApproved] = useState(0)
  const [charityBreakdown, setCharityBreakdown] = useState<CharityBreakdown[]>([])

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setLoading(true); setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const resp = await fetch('/api/admin/portalInsights', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json()
      if (!resp.ok || !json.ok) throw new Error(json.error || 'Failed to load portal insights')

      setTotalCharities(json.totalCharities)
      setTotalSubmissions(json.totalSubmissions)
      setTotalGiftAidClaimed(json.totalGiftAidClaimed)
      setTotalDonations(json.totalDonations)
      setTotalApproved(json.totalApproved)
      setCharityBreakdown(json.charityBreakdown || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const fmt = (n: number) => `£${n.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <div className="flex items-center gap-6">
              <button onClick={() => navigate('/admin/insights')} className="text-sm font-medium text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/admin/pending-charities')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Pending Charities</button>
              <button onClick={() => navigate('/admin/activity-log')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Activity Log</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <h1 className="text-3xl font-bold text-brand-primary">Insights</h1>
          <p className="text-gray-400 text-sm mt-1">Gift Aid claimed across every charity in the portal</p>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12 space-y-6">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>}

          {loading ? (
            <div className="text-center text-gray-300 py-10">Loading…</div>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Charities', value: String(totalCharities) },
                  { label: 'Total Gift Aid Claimed', value: fmt(totalGiftAidClaimed) },
                  { label: 'Total Submissions', value: String(totalSubmissions) },
                  { label: 'Approved by HMRC', value: String(totalApproved) },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className="text-2xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400">
                {totalDonations} donation{totalDonations !== 1 ? 's' : ''} recorded in total across all submissions.
              </p>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-50"><h2 className="font-semibold text-brand-primary">By Charity</h2></div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-50">
                    <thead>
                      <tr className="bg-gray-50/50">
                        {['Charity', 'Gift Aid Claimed', 'Submissions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {charityBreakdown.length === 0 ? (
                        <tr><td colSpan={3} className="px-4 py-8 text-center text-gray-300">No charities found</td></tr>
                      ) : charityBreakdown.map(c => (
                        <tr key={c.name} className="hover:bg-brand-surface/40 transition-colors">
                          <td className="px-4 py-3 text-sm font-medium text-brand-primary whitespace-nowrap">{c.name}</td>
                          <td className="px-4 py-3 text-sm font-bold text-brand-accent whitespace-nowrap">{fmt(c.giftAid)}</td>
                          <td className="px-4 py-3 text-sm text-gray-500">{c.submissions}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
