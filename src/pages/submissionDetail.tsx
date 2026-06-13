import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useParams, useNavigate, useLocation } from 'react-router-dom'

interface Submission { id: string; submission_date: string; status: string; hmrc_reference: string | null; amount_claimed: number; number_of_donations: number; tax_year: string; notes: string | null }
interface Donation { id: string; title: string | null; first_name: string; last_name: string; address: string; postcode: string; donation_date: string; amount: number }

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

const statusColor = (s: string) => {
  if (s === 'approved') return 'bg-green-100 text-green-700'
  if (s === 'rejected') return 'bg-red-100 text-red-700'
  if (s === 'submitted') return 'bg-blue-100 text-blue-700'
  return 'bg-yellow-100 text-yellow-700'
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
    if (!donations.length) return
    const headers = ['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount (£)']
    const rows = donations.map(d => [d.title || '', d.first_name, d.last_name, d.address, d.postcode, d.donation_date, parseFloat(String(d.amount)).toFixed(2)])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `submission-${submission?.tax_year?.replace('/', '-')}-${submission?.submission_date}.csv`; a.click()
    URL.revokeObjectURL(url)
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
              <button onClick={() => navigate('/profile')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">My Profile</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-4">
          <h1 className="text-3xl font-bold text-brand-primary">Submission Detail</h1>
          <p className="text-gray-400 text-sm mt-1">Read-only view of donor records</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate(backUrl)} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back</button>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          {submission && (
            <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6 mb-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-brand-primary mb-3">Submission Details</h2>
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                    <dt className="text-gray-400">Date submitted</dt><dd className="font-medium text-gray-600">{new Date(submission.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
                    <dt className="text-gray-400">Tax year</dt><dd className="font-medium text-gray-600">{submission.tax_year}</dd>
                    <dt className="text-gray-400">Donations</dt><dd className="font-medium text-gray-600">{submission.number_of_donations}</dd>
                    <dt className="text-gray-400">Gift Aid claimed</dt><dd className="font-bold text-brand-accent">£{parseFloat(String(submission.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</dd>
                    {submission.hmrc_reference && (<><dt className="text-gray-400">HMRC reference</dt><dd className="font-mono font-medium text-gray-600">{submission.hmrc_reference}</dd></>)}
                  </dl>
                </div>
                <span className={`px-3 py-1 text-sm font-semibold rounded-full ${statusColor(submission.status)}`}>{submission.status.charAt(0).toUpperCase() + submission.status.slice(1)}</span>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-semibold text-brand-primary">
                Donation Records
                {donations.length > 0 && <span className="ml-2 text-sm font-normal text-gray-400">({donations.length} donor{donations.length !== 1 ? 's' : ''})</span>}
              </h3>
              <button onClick={downloadCSV} disabled={!donations.length}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-brand-accent/30 text-brand-accent text-sm font-medium rounded-lg hover:bg-brand-accent hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                Export CSV
              </button>
            </div>
            {donations.length === 0 ? (
              <div className="px-6 py-12 text-center text-gray-300">No donor records available for this submission.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-50">
                  <thead><tr className="bg-gray-50/50">{['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount'].map(h => (<th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>))}</tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {donations.map(d => (
                      <tr key={d.id} className="hover:bg-brand-surface/40 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-400">{d.title || '—'}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.first_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.last_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.address}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{d.postcode}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{d.donation_date}</td>
                        <td className="px-4 py-3 text-sm font-bold text-brand-accent whitespace-nowrap">£{parseFloat(String(d.amount)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t-2 border-gray-100 bg-gray-50/50">
                    <tr>
                      <td colSpan={6} className="px-4 py-3 text-sm font-semibold text-right text-gray-400">Total donations</td>
                      <td className="px-4 py-3 text-sm font-bold text-brand-accent">£{donations.reduce((s, d) => s + parseFloat(String(d.amount)), 0).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
