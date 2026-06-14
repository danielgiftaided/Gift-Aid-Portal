import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, ResponsiveContainer, Legend
} from 'recharts'

interface Submission {
  id: string; submission_date: string; status: string
  amount_claimed: number; number_of_donations: number; tax_year: string
}

interface Donation {
  amount: number; submission_id: string
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

const TEAL = '#0c745d'
const NAVY = '#304675'
const CREAM = '#e8e4db'

function formatGBP(val: number) {
  return `£${val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function CustomTooltipGBP({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-4 py-3 text-sm">
      <p className="font-semibold text-brand-primary mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }}>
          {p.name}: {formatGBP(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function Insights() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const meResp = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      const meJson = await meResp.json()
      if (!meResp.ok || !meJson.ok) { navigate('/login'); return }
      if (meJson.charityId) {
        const { data } = await supabase
          .from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations, tax_year')
          .eq('charity_id', meJson.charityId)
          .order('submission_date', { ascending: true })
        const subs = data || []
        setSubmissions(subs)

        // Fetch individual donation rows to calculate per-donor averages
        if (subs.length > 0) {
          const { data: donData } = await supabase
            .from('donations')
            .select('amount, submission_id')
            .in('submission_id', subs.map(s => s.id))
          setDonations(donData || [])
        }
      }
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }

  // ── Chart 1: Gift Aid claimed by tax year ──
  const byTaxYear = Object.values(
    submissions.reduce((acc, s) => {
      const key = s.tax_year
      if (!acc[key]) acc[key] = { taxYear: key, giftAid: 0, donations: 0 }
      acc[key].giftAid += parseFloat(String(s.amount_claimed || 0))
      acc[key].donations += s.number_of_donations
      return acc
    }, {} as Record<string, { taxYear: string; giftAid: number; donations: number }>)
  ).sort((a, b) => a.taxYear.localeCompare(b.taxYear))

  // ── Chart 6: Average Gift Aid per submission over time ──
  const avgData = submissions.map((s, i) => {
    const runningTotal = submissions.slice(0, i + 1).reduce((sum, x) => sum + parseFloat(String(x.amount_claimed || 0)), 0)
    return {
      date: new Date(s.submission_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      thisSubmission: parseFloat(String(s.amount_claimed || 0)),
      runningAverage: Math.round((runningTotal / (i + 1)) * 100) / 100,
    }
  })

  // ── Average Gift Aid per donor ──
  const totalDonationAmount = donations.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
  const totalDonorCount = donations.length
  const avgGiftAidPerDonor = totalDonorCount > 0 ? (totalDonationAmount * 0.25) / totalDonorCount : 0

  // Average Gift Aid per donor by tax year (using submission tax_year + donation amounts)
  const avgPerDonorByYear = byTaxYear.map(ty => {
    const subIds = submissions.filter(s => s.tax_year === ty.taxYear).map(s => s.id)
    const yearDonations = donations.filter(d => subIds.includes(d.submission_id))
    const yearTotal = yearDonations.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
    const yearCount = yearDonations.length
    return {
      taxYear: ty.taxYear,
      avgGiftAid: yearCount > 0 ? Math.round((yearTotal * 0.25 / yearCount) * 100) / 100 : 0,
      donorCount: yearCount,
    }
  })
    ? submissions.reduce((s, r) => s + parseFloat(String(r.amount_claimed || 0)), 0) / submissions.length
    : 0

  const statusColor = (s: string) => {
    if (s === 'approved') return 'text-green-600'
    if (s === 'rejected') return 'text-red-500'
    if (s === 'submitted') return 'text-blue-500'
    return 'text-yellow-500'
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
          <h1 className="text-3xl font-bold text-brand-primary">Insights</h1>
          <p className="text-gray-400 text-sm mt-1">Analysis of your Gift Aid submissions</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back to dashboard</button>

          {submissions.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No submission data yet</p>
              <p className="text-gray-300 text-sm mt-1">Insights will appear once submissions have been created</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* ── Chart 1: Gift Aid by Tax Year ── */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <h2 className="font-semibold text-brand-primary mb-1">Gift Aid Claimed by Tax Year</h2>
                <p className="text-xs text-gray-400 mb-6">Total Gift Aid reclaimed from HMRC for each UK tax year</p>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={byTaxYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <YAxis tickFormatter={v => `£${(v/1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <Tooltip content={<CustomTooltipGBP />} />
                    <Bar dataKey="giftAid" name="Gift Aid" fill={TEAL} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {byTaxYear.length > 1 && (
                  <div className="mt-4 flex gap-6 pt-4 border-t border-gray-50">
                    {byTaxYear.map(d => (
                      <div key={d.taxYear}>
                        <p className="text-xs text-gray-400">{d.taxYear}</p>
                        <p className="text-sm font-bold text-brand-accent">{formatGBP(d.giftAid)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Chart 6: Average Gift Aid per Submission ── */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Submission</h2>
                    <p className="text-xs text-gray-400">Each bar shows a submission's value; the line tracks the running average</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Overall average</p>
                    <p className="text-2xl font-bold text-brand-accent">{formatGBP(overallAvg)}</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={avgData} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <YAxis tickFormatter={v => `£${(v/1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <Tooltip content={<CustomTooltipGBP />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="thisSubmission" name="This submission" fill={CREAM} stroke={NAVY} strokeWidth={1} radius={[3, 3, 0, 0]} />
                    <Line dataKey="runningAverage" name="Running average" type="monotone" stroke={TEAL} strokeWidth={2.5} dot={{ fill: TEAL, r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* ── Average Gift Aid per Donor ── */}
              {donations.length > 0 && (
                <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Donor</h2>
                      <p className="text-xs text-gray-400">Average Gift Aid reclaimed per individual donor, broken down by tax year</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Overall average</p>
                      <p className="text-2xl font-bold text-brand-accent">{formatGBP(avgGiftAidPerDonor)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">across {totalDonorCount} donor{totalDonorCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  {avgPerDonorByYear.length > 0 && avgPerDonorByYear.some(d => d.donorCount > 0) ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={avgPerDonorByYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                        <YAxis tickFormatter={v => `£${v.toFixed(0)}`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                        <Tooltip content={
                          <CustomTooltipGBP />
                        } />
                        <Bar dataKey="avgGiftAid" name="Avg Gift Aid per donor" fill={NAVY} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <p className="text-sm text-gray-300 text-center py-8">Upload donation spreadsheets to see per-donor breakdown</p>
                  )}
                </div>
              )}

              {/* Summary strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Tax years on record', value: String(byTaxYear.length) },
                  { label: 'Total submissions', value: String(submissions.length) },
                  { label: 'Avg Gift Aid per donor', value: totalDonorCount > 0 ? formatGBP(avgGiftAidPerDonor) : '—' },
                  { label: 'Best tax year', value: byTaxYear.length ? byTaxYear.reduce((a, b) => b.giftAid > a.giftAid ? b : a).taxYear : '—' },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{c.label}</div>
                    <div className="text-xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
