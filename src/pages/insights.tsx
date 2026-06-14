import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Line, ResponsiveContainer, Legend
} from 'recharts'

interface Submission {
  id: string; submission_date: string; status: string
  amount_claimed: number; number_of_donations: number; tax_year: string
}
interface Donation { amount: number; submission_id: string }

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
const WARM = '#e8e4db'

function fmt(val: number) {
  return `£${val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function GBPTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-4 py-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>
          {p.name}: {fmt(Number(p.value))}
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
  const [error, setError] = useState<string | null>(null)

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

      if (meJson.charityId) {
        const { data: subData, error: subErr } = await supabase
          .from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations, tax_year')
          .eq('charity_id', meJson.charityId)
          .order('submission_date', { ascending: true })
        if (subErr) throw new Error(subErr.message)
        const subs = subData || []
        setSubmissions(subs)

        if (subs.length > 0) {
          const { data: donData } = await supabase
            .from('donations')
            .select('amount, submission_id')
            .in('submission_id', subs.map(s => s.id))
          setDonations(donData || [])
        }
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Chart 1: Gift Aid by tax year ──
  const byTaxYear = Object.values(
    submissions.reduce((acc, s) => {
      const k = s.tax_year || 'Unknown'
      if (!acc[k]) acc[k] = { taxYear: k, giftAid: 0 }
      acc[k].giftAid += parseFloat(String(s.amount_claimed || 0))
      return acc
    }, {} as Record<string, { taxYear: string; giftAid: number }>)
  ).sort((a, b) => a.taxYear.localeCompare(b.taxYear))

  // ── Chart 6: Average Gift Aid per submission over time ──
  const avgOverTime = submissions.map((s, i) => {
    const runningTotal = submissions
      .slice(0, i + 1)
      .reduce((sum, x) => sum + parseFloat(String(x.amount_claimed || 0)), 0)
    return {
      date: new Date(s.submission_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      claimed: parseFloat(String(s.amount_claimed || 0)),
      runningAvg: Math.round((runningTotal / (i + 1)) * 100) / 100,
    }
  })

  const overallAvg = submissions.length
    ? submissions.reduce((s, r) => s + parseFloat(String(r.amount_claimed || 0)), 0) / submissions.length
    : 0

  // ── Average Gift Aid per donor ──
  const totalDonationAmount = donations.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
  const totalDonorCount = donations.length
  const avgGiftAidPerDonor = totalDonorCount > 0 ? (totalDonationAmount * 0.25) / totalDonorCount : 0

  const avgPerDonorByYear = byTaxYear.map(ty => {
    const subIds = submissions.filter(s => s.tax_year === ty.taxYear).map(s => s.id)
    const yearDons = donations.filter(d => subIds.includes(d.submission_id))
    const yearTotal = yearDons.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
    return {
      taxYear: ty.taxYear,
      avgGiftAid: yearDons.length > 0 ? Math.round((yearTotal * 0.25 / yearDons.length) * 100) / 100 : 0,
    }
  })

  if (loading) return (
    <div className="min-h-screen bg-brand-surface flex items-center justify-center">
      <p className="text-brand-accent font-medium">Loading…</p>
    </div>
  )

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
          <h1 className="text-3xl font-bold text-brand-primary">Insights</h1>
          <p className="text-gray-400 text-sm mt-1">Analysis of your Gift Aid submissions</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back to dashboard</button>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>}

          {submissions.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No submission data yet</p>
              <p className="text-gray-300 text-sm mt-1">Insights will appear once submissions have been created</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Summary strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Tax years on record',      value: String(byTaxYear.length) },
                  { label: 'Total submissions',         value: String(submissions.length) },
                  { label: 'Avg Gift Aid / submission', value: fmt(overallAvg) },
                  { label: 'Avg Gift Aid / donor',      value: totalDonorCount > 0 ? fmt(avgGiftAidPerDonor) : '—' },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className="text-2xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Chart 1 — Gift Aid by tax year */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <h2 className="font-semibold text-brand-primary mb-1">Gift Aid Claimed by Tax Year</h2>
                <p className="text-xs text-gray-400 mb-6">Total Gift Aid reclaimed from HMRC for each UK tax year</p>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={byTaxYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <YAxis tickFormatter={v => `£${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <Tooltip content={<GBPTooltip />} />
                    <Bar dataKey="giftAid" name="Gift Aid" fill={TEAL} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                {byTaxYear.length > 1 && (
                  <div className="mt-4 pt-4 border-t border-gray-50 flex flex-wrap gap-6">
                    {byTaxYear.map(d => (
                      <div key={d.taxYear}>
                        <p className="text-xs text-gray-400">{d.taxYear}</p>
                        <p className="text-sm font-bold text-brand-accent">{fmt(d.giftAid)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Chart 6 — Avg Gift Aid per submission over time */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Submission</h2>
                    <p className="text-xs text-gray-400">Each bar is a submission value; the line tracks the running average</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Overall average</p>
                    <p className="text-2xl font-bold text-brand-accent">{fmt(overallAvg)}</p>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <ComposedChart data={avgOverTime} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="date" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <YAxis tickFormatter={v => `£${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                    <Tooltip content={<GBPTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="claimed" name="This submission" fill={WARM} stroke={NAVY} strokeWidth={1} radius={[3, 3, 0, 0]} />
                    <Line dataKey="runningAvg" name="Running average" type="monotone" stroke={TEAL} strokeWidth={2.5} dot={{ fill: TEAL, r: 4 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* Average Gift Aid per donor */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Donor</h2>
                    <p className="text-xs text-gray-400">Average Gift Aid reclaimed per individual donor, by tax year</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Overall average</p>
                    <p className="text-2xl font-bold text-brand-accent">
                      {totalDonorCount > 0 ? fmt(avgGiftAidPerDonor) : '—'}
                    </p>
                    {totalDonorCount > 0 && (
                      <p className="text-xs text-gray-400 mt-0.5">{totalDonorCount} donor{totalDonorCount !== 1 ? 's' : ''}</p>
                    )}
                  </div>
                </div>
                {totalDonorCount > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={avgPerDonorByYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <YAxis tickFormatter={v => `£${v.toFixed(0)}`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <Tooltip content={<GBPTooltip />} />
                      <Bar dataKey="avgGiftAid" name="Avg Gift Aid per donor" fill={NAVY} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-sm text-gray-300 text-center py-8">
                    Upload donation spreadsheets through the admin portal to see per-donor breakdown
                  </p>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
