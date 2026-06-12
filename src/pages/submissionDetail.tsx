import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useParams, useNavigate, useLocation } from 'react-router-dom'

interface Submission {
  id: string; submission_date: string; status: string
  hmrc_reference: string | null; amount_claimed: number
  number_of_donations: number; tax_year: string; notes: string | null
}
interface Donation {
  id: string; title: string | null; first_name: string; last_name: string
  address: string; postcode: string; donation_date: string; amount: number
}

function statusColor(s: string) {
  if (s === 'approved') return 'bg-green-100 text-green-800'
  if (s === 'rejected') return 'bg-red-100 text-red-800'
  if (s === 'submitted') return 'bg-blue-100 text-blue-800'
  return 'bg-yellow-100 text-yellow-800'
}

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const backUrl = (location.state as any)?.backUrl ?? '/submissions'

  const [submission, setSubmission] = useState<Submission | null>(null)
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (id) load() }, [id])

  const load = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: sub, error: subErr } = await supabase.from('submissions').select('*').eq('id', id).single()
      if (subErr) throw new Error(subErr.message)
      setSubmission(sub)
      const { data: don } = await supabase.from('donations').select('*').eq('submission_id', id).order('created_at', { ascending: true })
      setDonations(don || [])
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  const downloadCSV = () => {
    if (donations.length === 0) return
    const headers = ['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount (£)']
    const rows = donations.map(d => [d.title || '', d.first_name, d.last_name, d.address, d.postcode, d.donation_date, parseFloat(String(d.amount)).toFixed(2)])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `submission-${submission?.tax_year?.replace('/', '-')}-${submission?.submission_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
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
          <h1 className="text-2xl font-bold text-white">Submission Detail</h1>
          <p className="text-white/75 text-sm mt-1">Read-only view of donor records for this submission</p>
        </div>
      </div>

      {/* Block 3 — Cream content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate(backUrl)} className="text-brand-accent text-sm font-medium hover:underline mb-6 inline-block">
          ← Back
        </button>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

        {/* Submission summary */}
        {submission && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-brand-primary mb-3">Submission Details</h2>
                <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                  <dt className="text-gray-400">Date submitted</dt>
                  <dd className="font-medium text-gray-700">{new Date(submission.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
                  <dt className="text-gray-400">Tax year</dt>
                  <dd className="font-medium text-gray-700">{submission.tax_year}</dd>
                  <dt className="text-gray-400">Donations</dt>
                  <dd className="font-medium text-gray-700">{submission.number_of_donations}</dd>
                  <dt className="text-gray-400">Gift Aid claimed</dt>
                  <dd className="font-bold text-brand-accent">£{parseFloat(String(submission.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</dd>
                  {submission.hmrc_reference && (<><dt className="text-gray-400">HMRC reference</dt><dd className="font-mono font-medium text-gray-700">{submission.hmrc_reference}</dd></>)}
                </dl>
              </div>
              <span className={`px-3 py-1 text-sm font-semibold rounded-full ${statusColor(submission.status)}`}>
                {submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}
              </span>
            </div>
          </div>
        )}

        {/* Donation rows */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-brand-primary/5">
            <h3 className="font-semibold text-brand-primary">
              Donation Records
              {donations.length > 0 && <span className="ml-2 text-sm font-normal text-gray-400">({donations.length} donor{donations.length !== 1 ? 's' : ''})</span>}
            </h3>
            <button onClick={downloadCSV} disabled={donations.length === 0}
              title={donations.length === 0 ? 'No records to export' : 'Export as CSV'}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-accent/30 text-brand-accent text-sm font-medium rounded-lg hover:bg-brand-accent hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          </div>

          {donations.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400">No donor records available for this submission.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-100">
                <thead>
                  <tr className="bg-gray-50">
                    {['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {donations.map(d => (
                    <tr key={d.id} className="hover:bg-brand-surface/50 transition-colors">
                      <td className="px-4 py-3 text-sm text-gray-400">{d.title || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{d.first_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{d.last_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{d.address}</td>
                      <td className="px-4 py-3 text-sm text-gray-700">{d.postcode}</td>
                      <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{d.donation_date}</td>
                      <td className="px-4 py-3 text-sm font-semibold text-brand-accent whitespace-nowrap">
                        £{parseFloat(String(d.amount)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200 bg-gray-50">
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-right text-gray-500">Total donations</td>
                    <td className="px-4 py-3 text-sm font-bold text-brand-accent">
                      £{donations.reduce((s, d) => s + parseFloat(String(d.amount)), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
