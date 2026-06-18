import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { fetchAllRows } from '../utils/fetchAll'

interface Submission { id: string; submission_date: string; status: string; hmrc_reference: string | null; amount_claimed: number; number_of_donations: number; tax_year: string; notes: string | null }

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

export default function Submissions() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session) { navigate('/login'); return }
        const { data: userData } = await supabase.from('users').select('charity_id').eq('id', session.user.id).single()
        if (userData?.charity_id) {
          const data = await fetchAllRows<Submission>(() =>
            supabase.from('submissions').select('*').eq('charity_id', userData.charity_id).order('submission_date', { ascending: false })
          )
          setSubmissions(data)
        }
      } catch (e) { console.error(e) } finally { setLoading(false) }
    })()
  }, [])

  const statusColor = (s: string) => {
    if (s === 'approved') return 'bg-green-100 text-green-700'
    if (s === 'rejected') return 'bg-red-100 text-red-700'
    if (s === 'submitted') return 'bg-blue-100 text-blue-700'
    return 'bg-yellow-100 text-yellow-700'
  }

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Logo />
                        <div className="flex items-center gap-5">
              <button onClick={() => navigate('/insights')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/profile')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">My Profile</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-4">
          <h1 className="text-3xl font-bold text-brand-primary">Your Gift Aid Submissions</h1>
          <p className="text-gray-400 text-sm mt-1">Click any row to view donor records</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back to dashboard</button>

          {submissions.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No submissions found</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <table className="min-w-full divide-y divide-gray-50">
                <thead><tr className="bg-gray-50/50">
                  {['Submission Date', 'Tax Year', 'Gift Aid Claimed', 'Donations', 'Status', 'HMRC Reference'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {submissions.map(s => (
                    <tr key={s.id} onClick={() => navigate(`/submissions/${s.id}`)} className="hover:bg-brand-surface/50 cursor-pointer transition-colors">
                      <td className="px-6 py-4 text-sm text-gray-600">{new Date(s.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-600">{s.tax_year}</td>
                      <td className="px-6 py-4 text-sm font-bold text-brand-accent">£{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className="px-6 py-4 text-sm text-gray-500">{s.number_of_donations} donations</td>
                      <td className="px-6 py-4"><span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColor(s.status)}`}>{s.status.charAt(0).toUpperCase() + s.status.slice(1)}</span></td>
                      <td className="px-6 py-4 text-sm text-gray-400 font-mono">{s.hmrc_reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
