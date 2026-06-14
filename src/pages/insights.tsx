import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

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

function fmt(val: number) {
  return `£${val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Simple CSS bar chart — no external library needed
function CSSBarChart({ data, valueKey, labelKey, color }: {
  data: Record<string, any>[]
  valueKey: string
  labelKey: string
  color: string
}) {
  const max = Math.max(...data.map(d => d[valueKey]), 1)
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span className="font-medium">{d[labelKey]}</span>
            <span className="font-bold" style={{ color }}>{fmt(d[valueKey])}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-6 overflow-hidden">
            <div
              className="h-6 rounded-full transition-all duration-500"
              style={{ width: `${Math.max((d[valueKey] / max) * 100, 2)}%`, background: color }}
            />
          </div>
        </div>
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

  // ── Chart 6: Avg Gift Aid per submission ──
  const overallAvg = submissions.length
    ? submissions.reduce((s, r) => s + parseFloat(String(r.amount_claimed || 0)), 0) / submissions.length
    : 0

  const avgPerSubmission = submissions.map((s, i) => {
    const runningTotal = submissions.slice(0, i + 1)
      .reduce((sum, x) => sum + parseFloat(String(x.amount_claimed || 0)), 0)
    return {
      label: new Date(s.submission_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }),
      claimed: parseFloat(String(s.amount_claimed || 0)),
      runningAvg: runningTotal / (i + 1),
    }
  })

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
      avgGiftAid: yearDons.length > 0 ? yearTotal * 0.25 / yearDons.length : 0,
    }
  }).filter(d => d.avgGiftAid > 0)

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
                  { label: 'Tax years on record', value: String(byTaxYear.length) },
                  { label: 'Total submissions',   value: String(submissions.length) },
                  { label: 'Avg Gift Aid / submission', value: fmt(overallAvg) },
                  { label: 'Avg Gift Aid / donor', value: totalDonorCount > 0 ? fmt(avgGiftAidPerDonor) : '—' },
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
                <CSSBarChart data={byTaxYear} valueKey="giftAid" labelKey="taxYear" color="#0c745d" />
              </div>

              {/* Chart 6 — Avg Gift Aid per submission */}
              <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-semibold text-brand-primary mb-1">Gift Aid per Submission</h2>
                    <p className="text-xs text-gray-400">Individual submission values and running average</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">Overall average</p>
                    <p className="text-2xl font-bold text-brand-accent">{fmt(overallAvg)}</p>
                  </div>
                </div>
                <CSSBarChart data={avgPerSubmission} valueKey="claimed" labelKey="label" color="#304675" />
                {avgPerSubmission.length > 1 && (
                  <div className="mt-6 pt-4 border-t border-gray-50">
                    <p className="text-xs text-gray-400 mb-3">Running average</p>
                    <CSSBarChart data={avgPerSubmission} valueKey="runningAvg" labelKey="label" color="#0c745d" />
                  </div>
                )}
              </div>

              {/* Average Gift Aid per donor */}
              {avgPerDonorByYear.length > 0 && (
                <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Donor</h2>
                      <p className="text-xs text-gray-400">Average Gift Aid per individual donor, by tax year</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Overall average</p>
                      <p className="text-2xl font-bold text-brand-accent">{fmt(avgGiftAidPerDonor)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{totalDonorCount} donor{totalDonorCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <CSSBarChart data={avgPerDonorByYear} valueKey="avgGiftAid" labelKey="taxYear" color="#304675" />
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
