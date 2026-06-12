import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface Submission {
  id: string; submission_date: string; status: string
  hmrc_reference: string | null; amount_claimed: number
  number_of_donations: number; tax_year: string; notes: string | null
}

export default function Submissions() {
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: userData } = await supabase.from('users').select('charity_id').eq('id', session.user.id).single()
      if (userData?.charity_id) {
        const { data } = await supabase.from('submissions').select('*').eq('charity_id', userData.charity_id).order('submission_date', { ascending: false })
        setSubmissions(data || [])
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  const statusColor = (s: string) => {
    if (s === 'approved') return 'bg-green-100 text-green-800'
    if (s === 'rejected') return 'bg-red-100 text-red-800'
    if (s === 'submitted') return 'bg-blue-100 text-blue-800'
    return 'bg-yellow-100 text-yellow-800'
  }

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><div className="text-brand-primary font-medium">Loading…</div></div>

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
          <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
            className="text-sm text-white/70 hover:text-white transition-colors">Log Out</button>
        </div>
      </nav>

      {/* Block 2 — Teal banner */}
      <div className="bg-brand-accent">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Your Gift Aid Submissions</h1>
          <p className="text-white/75 text-sm mt-1">Click any submission to view donor records</p>
        </div>
      </div>

      {/* Block 3 — Cream content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate('/dashboard')} className="text-brand-accent text-sm font-medium hover:underline mb-6 inline-block">
          ← Back to dashboard
        </button>

        {submissions.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-12 text-center">
            <p className="text-gray-400 text-lg">No submissions found</p>
            <p className="text-gray-300 mt-1 text-sm">Submissions will appear here once they are created</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="min-w-full divide-y divide-gray-100">
              <thead>
                <tr className="bg-gray-50">
                  {['Submission Date', 'Tax Year', 'Gift Aid Claimed', 'Donations', 'Status', 'HMRC Reference'].map(h => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {submissions.map(s => (
                  <tr key={s.id} onClick={() => navigate(`/submissions/${s.id}`)}
                    className="hover:bg-brand-surface/60 cursor-pointer transition-colors">
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {new Date(s.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-700">{s.tax_year}</td>
                    <td className="px-6 py-4 text-sm font-bold text-brand-accent">
                      £{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">{s.number_of_donations} donations</td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs font-semibold rounded-full ${statusColor(s.status)}`}>
                        {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400 font-mono">{s.hmrc_reference || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
