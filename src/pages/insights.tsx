import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { fetchAllRows } from '../utils/fetchAll'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ComposedChart, Line, ResponsiveContainer, Legend
} from 'recharts'

interface Submission { id: string; submission_date: string; status: string; amount_claimed: number; number_of_donations: number; tax_year: string }
interface Donation { amount: number; submission_id: string }
interface UploadedRecord {
  record_status: 'valid' | 'incomplete' | 'opt_out'
  tax_year: string | null
  amount: number | null
  donation_date: string | null
  title: string | null
  first_name: string | null
  last_name: string | null
  address: string | null
  postcode: string | null
  gift_aid_opt_in: string | null
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
const WARM = '#e8e4db'

function fmt(val: number) {
  return `£${val.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// Recomputes the tax year from each row's own donation date rather than
// trusting the stored tax_year column, which protects against any stale
// values written before per-row tax year calculation was fixed.
function parseDonationDateForTaxYear(str: string | null): Date | null {
  if (!str) return null
  const trimmed = str.trim()
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10)
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day)
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    }
  }
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) {
    const year = parseInt(ymd[1], 10), month = parseInt(ymd[2], 10), day = parseInt(ymd[3], 10)
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
  }
  const fallback = new Date(trimmed)
  return isNaN(fallback.getTime()) ? null : fallback
}

function getTaxYearForDateForInsights(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`
}

function effectiveTaxYear(r: UploadedRecord): string {
  const parsed = parseDonationDateForTaxYear(r.donation_date)
  if (parsed) return getTaxYearForDateForInsights(parsed)
  return r.tax_year || getTaxYearForDateForInsights(new Date())
}

// Formats a raw donation date string as UK short date DD/MM/YYYY for exports
function formatUkDateForExport(raw: string | null): string {
  if (!raw) return ''
  const parsed = parseDonationDateForTaxYear(raw)
  if (!parsed) return raw
  const dd = String(parsed.getDate()).padStart(2, '0')
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${parsed.getFullYear()}`
}

// Escapes a single CSV field — wraps in quotes and doubles any internal quotes
// whenever the value contains a comma, quote, or newline.
function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function downloadRecordsAsCsv(rows: UploadedRecord[], filename: string) {
  const headers = ['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount', 'Gift Aid Opt In', 'Tax Year']
  const lines = [headers.join(',')]

  for (const r of rows) {
    const fields = [
      r.title || '',
      r.first_name || '',
      r.last_name || '',
      r.address || '',
      (r.postcode || '').toUpperCase(),
      formatUkDateForExport(r.donation_date),
      r.amount != null ? parseFloat(String(r.amount)).toFixed(2) : '',
      r.gift_aid_opt_in || '',
      effectiveTaxYear(r),
    ]
    lines.push(fields.map(f => csvEscape(String(f))).join(','))
  }

  const csvContent = lines.join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function GBPTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-4 py-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>
          {p.name}: {typeof p.value === 'number' ? (p.value > 1 && p.name.toLowerCase().includes('£') ? fmt(p.value) : p.value) : p.value}
        </p>
      ))}
    </div>
  )
}

export default function Insights() {
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [records, setRecords] = useState<UploadedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const meResp = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      const meJson = await meResp.json()
      if (!meResp.ok || !meJson.ok) { navigate('/login'); return }

      if (meJson.charityId) {
        const subs = await fetchAllRows<Submission>(() =>
          supabase
            .from('submissions')
            .select('id, submission_date, status, amount_claimed, number_of_donations, tax_year')
            .eq('charity_id', meJson.charityId)
            .order('submission_date', { ascending: true })
        )
        setSubmissions(subs)

        if (subs.length > 0) {
          const donData = await fetchAllRows<Donation>(() =>
            supabase
              .from('donations').select('amount, submission_id')
              .in('submission_id', subs.map(s => s.id))
          )
          setDonations(donData)
        }

        const recData = await fetchAllRows<UploadedRecord>(() =>
          supabase
            .from('uploaded_records').select('record_status, tax_year, amount, donation_date, title, first_name, last_name, address, postcode, gift_aid_opt_in')
            .eq('charity_id', meJson.charityId)
        )
        setRecords(recData)
      }
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
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
  const avgOverTime = submissions.map((s, i) => {
    const runningTotal = submissions.slice(0, i + 1).reduce((sum, x) => sum + parseFloat(String(x.amount_claimed || 0)), 0)
    return {
      date: new Date(s.submission_date).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }),
      claimed: parseFloat(String(s.amount_claimed || 0)),
      runningAvg: Math.round(runningTotal / (i + 1) * 100) / 100,
    }
  })
  const overallAvg = submissions.length ? submissions.reduce((s, r) => s + parseFloat(String(r.amount_claimed || 0)), 0) / submissions.length : 0

  // ── Avg Gift Aid per donor ──
  const totalDonationAmount = donations.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
  const totalDonorCount = donations.length
  const avgGiftAidPerDonor = totalDonorCount > 0 ? (totalDonationAmount * 0.25) / totalDonorCount : 0

  const avgPerDonorByYear = byTaxYear.map(ty => {
    const subIds = submissions.filter(s => s.tax_year === ty.taxYear).map(s => s.id)
    const yearDons = donations.filter(d => subIds.includes(d.submission_id))
    const yearTotal = yearDons.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
    return { taxYear: ty.taxYear, avgGiftAid: yearDons.length > 0 ? Math.round(yearTotal * 0.25 / yearDons.length * 100) / 100 : 0 }
  })

  // ── Record overview (from uploaded_records) ──
  const validCount     = records.filter(r => r.record_status === 'valid').length
  const incompleteCount = records.filter(r => r.record_status === 'incomplete').length
  const optOutCount    = records.filter(r => r.record_status === 'opt_out').length
  const totalRecords   = records.length

  // Potential Gift Aid that ISN'T being captured — combines incomplete records
  // (missing data, fixable) and opt-outs (donor declined) into one figure
  const missedRecords = records.filter(r => r.record_status === 'incomplete' || r.record_status === 'opt_out')
  const missedDonationValue = missedRecords.reduce((s, r) => s + (parseFloat(String(r.amount)) || 0), 0)
  const potentialMissedGiftAid = missedDonationValue * 0.25

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
          <h1 className="text-3xl font-bold text-brand-primary">Insights</h1>
          <p className="text-gray-400 text-sm mt-1">Analysis of your Gift Aid submissions and donor data</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back to dashboard</button>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>}

          {submissions.length === 0 && records.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No data yet</p>
              <p className="text-gray-300 text-sm mt-1">Insights will appear once submissions have been uploaded</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Summary strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { label: 'Total records',         value: String(totalRecords) },
                  { label: 'Gift Aid Claimed',      value: totalDonorCount > 0 ? fmt(totalDonationAmount * 0.25) : '—' },
                  { label: 'Avg Gift Aid / donor',  value: totalDonorCount > 0 ? fmt(avgGiftAidPerDonor) : '—' },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className="text-2xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Chart 1 */}
              {submissions.length > 0 && (
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
                </div>
              )}

              {/* Chart 6 */}
              {submissions.length > 0 && (
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
                  <ResponsiveContainer width="100%" height={260}>
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
              )}

              {/* Avg Gift Aid per donor */}
              {totalDonorCount > 0 && (
                <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Donor</h2>
                      <p className="text-xs text-gray-400">Average Gift Aid reclaimed per individual donor, by tax year</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Overall average</p>
                      <p className="text-2xl font-bold text-brand-accent">{fmt(avgGiftAidPerDonor)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{totalDonorCount} donor{totalDonorCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={avgPerDonorByYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <YAxis tickFormatter={v => `£${v.toFixed(0)}`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <Tooltip content={<GBPTooltip />} />
                      <Bar dataKey="avgGiftAid" name="Avg Gift Aid per donor" fill={NAVY} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Record overview — opt out & incomplete */}
              {totalRecords > 0 && (
                <>
                  {/* Headline counts */}
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { label: 'Records Claimed',    value: validCount,      sub: 'Submitted to HMRC and claimed', color: 'border-brand-accent text-brand-accent', status: 'valid' as const,      filename: 'submitted-claims.csv' },
                      { label: 'Incomplete records', value: incompleteCount, sub: 'Missing mandatory fields',      color: 'border-yellow-400 text-yellow-600',     status: 'incomplete' as const, filename: 'incomplete-records.csv' },
                      { label: 'Gift Aid opt outs',  value: optOutCount,     sub: 'Opted out — won\'t be claimed', color: 'border-gray-300 text-gray-500',         status: 'opt_out' as const,    filename: 'opt-out-records.csv' },
                    ].map(c => (
                      <div key={c.label} className={`bg-white rounded-xl border-l-4 border-t border-r border-b border-gray-100 shadow-sm p-5 ${c.color.split(' ')[0]}`}>
                        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                        <div className={`text-3xl font-bold ${c.color.split(' ')[1]}`}>{c.value}</div>
                        <div className="text-xs text-gray-400 mt-1">{c.sub}</div>
                        {totalRecords > 0 && <div className="text-xs text-gray-300 mt-0.5">{Math.round(c.value / totalRecords * 100)}% of all records</div>}
                        <button
                          onClick={() => downloadRecordsAsCsv(records.filter(r => r.record_status === c.status), c.filename)}
                          disabled={c.value === 0}
                          className="mt-3 text-xs font-semibold text-brand-accent hover:underline disabled:text-gray-300 disabled:no-underline disabled:cursor-not-allowed"
                        >
                          Export CSV
                        </button>
                      </div>
                    ))}
                  </div>

                  {/* Potential missed Gift Aid — incomplete + opt-out combined */}
                  {missedRecords.length > 0 && (
                    <div className="bg-white rounded-xl border-l-4 border-amber-400 border-t border-r border-b border-gray-100 shadow-sm p-6">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h2 className="font-semibold text-brand-primary mb-1">Potential Missed Gift Aid</h2>
                          <p className="text-xs text-gray-400 max-w-md">
                            Gift Aid value not currently being captured — combining donations with incomplete data and donors who opted out.
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-amber-600">{fmt(potentialMissedGiftAid)}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{missedRecords.length} record{missedRecords.length !== 1 ? 's' : ''} ({incompleteCount} incomplete, {optOutCount} opted out)</p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
