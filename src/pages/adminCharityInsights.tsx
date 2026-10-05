import ExportFlipCard from '../components/ExportFlipCard'
import { InsightTooltip as ChartTooltip, CurrencyInsightTooltip } from '../components/InsightTooltip'
import { giftAidRecordGroup, isOptOutRecord, isValidGiftAidRecord } from '../../shared/giftAidRecords'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchAllRows } from '../utils/fetchAll'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
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
  gift_aid_submitted: boolean | null
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

const TEAL = '#0c745d'; const NAVY = '#304675'; const AMBER = '#f59e0b'; const SLATE = '#94a3b8'

function fmt(v: number) { return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

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
  const headers = ['Title', 'First Name', 'Last Name', 'Address', 'Postcode', 'Donation Date', 'Amount', 'Gift Aid Opt In', 'Tax Year', 'Gift Aid Submitted', 'Record Group']
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
      r.gift_aid_submitted === false ? 'N' : 'Y',
      giftAidRecordGroup(r),
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

// Builds a filesystem-safe filename slug from the charity name, e.g.
// "Forgotten Women" -> "forgotten-women"
function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'charity'
}

export default function AdminCharityInsights() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [charityName, setCharityName] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [donations, setDonations] = useState<Donation[]>([])
  const [records, setRecords] = useState<UploadedRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (id) loadData() }, [id])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      // Fetch charity name
      const { data: charity } = await supabase.from('charities').select('name').eq('id', id).single()
      if (charity) setCharityName(charity.name)

      // Submissions
      const subs = await fetchAllRows<Submission>(() =>
        supabase
          .from('submissions')
          .select('id, submission_date, status, amount_claimed, number_of_donations, tax_year')
          .eq('charity_id', id)
          .order('submission_date', { ascending: true })
      )
      setSubmissions(subs)

      // Donations
      if (subs.length > 0) {
        const donData = await fetchAllRows<Donation>(() =>
          supabase
            .from('donations').select('amount, submission_id')
            .in('submission_id', subs.map(s => s.id))
        )
        setDonations(donData)
      }

      // All uploaded records for this charity
      const recData = await fetchAllRows<UploadedRecord>(() =>
        supabase
          .from('uploaded_records').select('record_status, tax_year, amount, donation_date, title, first_name, last_name, address, postcode, gift_aid_opt_in, gift_aid_submitted')
          .eq('charity_id', id)
      )
      setRecords(recData)

    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  // ── Calculations ──────────────────────────────────────
  const byTaxYear = Object.values(
    submissions.reduce((acc, s) => {
      const k = s.tax_year || 'Unknown'
      if (!acc[k]) acc[k] = { taxYear: k, giftAid: 0 }
      acc[k].giftAid += parseFloat(String(s.amount_claimed || 0))
      return acc
    }, {} as Record<string, { taxYear: string; giftAid: number }>)
  ).sort((a, b) => a.taxYear.localeCompare(b.taxYear))



  const totalDonationAmount = donations.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
  const totalDonorCount = donations.length
  const avgGiftAidPerDonor = totalDonorCount > 0 ? (totalDonationAmount * 0.25) / totalDonorCount : 0

  const avgPerDonorByYear = byTaxYear.map(ty => {
    const subIds = submissions.filter(s => s.tax_year === ty.taxYear).map(s => s.id)
    const yearDons = donations.filter(d => subIds.includes(d.submission_id))
    const yearTotal = yearDons.reduce((s, d) => s + parseFloat(String(d.amount || 0)), 0)
    return { taxYear: ty.taxYear, avgGiftAid: yearDons.length > 0 ? Math.round(yearTotal * 0.25 / yearDons.length * 100) / 100 : 0 }
  })

  const validCount     = records.filter(isValidGiftAidRecord).length
  const historicCount  = records.filter(r => giftAidRecordGroup(r) === 'historic').length
  const incompleteOptInCount = records.filter(r => giftAidRecordGroup(r) === 'incomplete_opt_in').length
  const incompleteOptOutCount = records.filter(r => giftAidRecordGroup(r) === 'incomplete_opt_out').length
  const optOutCount    = records.filter(isOptOutRecord).length
  const totalRecords   = records.length

  const taxYears = [...new Set(records.map(r => effectiveTaxYear(r)))].sort()
  const recordsByYear = taxYears.map(ty => ({
    taxYear: ty,
    valid:      records.filter(r => effectiveTaxYear(r) === ty && isValidGiftAidRecord(r)).length,
    historic: records.filter(r => effectiveTaxYear(r) === ty && giftAidRecordGroup(r) === 'historic').length,
    incomplete: records.filter(r => effectiveTaxYear(r) === ty && r.record_status === 'incomplete').length,
    optOut:     records.filter(r => effectiveTaxYear(r) === ty && r.record_status !== 'incomplete' && isOptOutRecord(r)).length,
  }))

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>

        <nav className="bg-white border-b border-gray-100">
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <h1 className="text-3xl font-bold text-brand-primary">{charityName || 'Insights'}</h1>

          {/* Tabs — mirrors adminCharityDetail.tsx; Insights is the active tab here */}
          <div className="flex gap-6 mt-6 border-b border-gray-100">
            {[
              { key: 'submissions', label: 'Submissions', action: () => navigate(`/admin/charities/${id}`) },
              { key: 'insights',    label: 'Insights',    action: () => {} },
              { key: 'chv1',        label: 'Charity Information', action: () => navigate(`/admin/charities/${id}?tab=chv1`) },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={tab.action}
                className={`pb-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  tab.key === 'insights'
                    ? 'border-brand-accent text-brand-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>}

          {submissions.length === 0 && records.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No data yet for this charity</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Summary strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Tax years on record',      value: String(byTaxYear.length) },
                  { label: 'Total submissions',         value: String(submissions.length) },
                  { label: 'Avg Gift Aid / donor',      value: totalDonorCount > 0 ? fmt(avgGiftAidPerDonor) : '—' },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className="text-2xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Record overview — opt out & incomplete */}
              {totalRecords > 0 && (
                <>
                  <p className="text-xs text-gray-500">The opt-out total includes incomplete opted-out rows. These cards overlap; total records counts each uploaded row once.</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: 'Valid for Gift Aid',  value: validCount,      sub: 'Submitted to HMRC',         border: 'border-brand-accent', text: 'text-brand-accent', status: 'valid' as const },
                      { label: 'Historic claims',     value: historicCount,   sub: 'Submitted outside Gift Aided', border: 'border-blue-300', text: 'text-blue-600', status: 'historic' as const },
                      { label: 'Incomplete — opted in', value: incompleteOptInCount, sub: 'Missing mandatory fields; opted in', border: 'border-yellow-400', text: 'text-yellow-600', status: 'incomplete_opt_in' as const },
                      { label: 'Incomplete — opted out', value: incompleteOptOutCount, sub: 'Missing mandatory fields; opted out', border: 'border-orange-400', text: 'text-orange-600', status: 'incomplete_opt_out' as const },
                      { label: 'Gift Aid opt outs',   value: optOutCount,     sub: 'All opted out, including incomplete rows', border: 'border-gray-300',     text: 'text-gray-500',     status: 'opt_out' as const },
                    ].map(c => (
                      <ExportFlipCard key={c.label} label={c.label} value={c.value} description={c.sub}
                        tone={c.text} percentage={Math.round(c.value / totalRecords * 100)}
                        onExport={() => downloadRecordsAsCsv(records.filter(r => c.status === 'opt_out' ? isOptOutRecord(r) : giftAidRecordGroup(r) === c.status), `${slugify(charityName)}-${c.status}-records.csv`)}
                      />
                    ))}
                  </div>

                  {recordsByYear.length > 0 && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                      <h2 className="font-semibold text-brand-primary mb-1">Record Breakdown by Tax Year</h2>
                      <p className="text-xs text-gray-400 mb-6">Gift Aided valid, historic, incomplete and complete opt-out records; each row appears once</p>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart barCategoryGap="28%" data={recordsByYear} margin={{ top: 12, right: 20, left: 0, bottom: 16 }}>
                          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
                          <XAxis axisLine={false} tickLine={false} tickMargin={12} minTickGap={24} dataKey="taxYear" tick={{ fontSize: 12, fill: '#64748b' }} />
                          <YAxis axisLine={false} tickLine={false} tickMargin={10} width={72} allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                          <Tooltip cursor={{ fill: '#f1f5f9', radius: 6 }} content={<ChartTooltip />} />
                          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 16, color: '#475569' }} />
                          <Bar maxBarSize={44} dataKey="valid"      name="Valid"      fill={TEAL}  stackId="a" radius={[0,0,0,0]} />
                          <Bar maxBarSize={44} dataKey="historic" name="Historic claims" fill={NAVY} stackId="a" />
                          <Bar maxBarSize={44} dataKey="incomplete" name="Incomplete" fill={AMBER} stackId="a" radius={[0,0,0,0]} />
                          <Bar maxBarSize={44} dataKey="optOut"     name="Opt out"   fill={SLATE} stackId="a" radius={[3,3,0,0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </>
              )}

              {/* Gift Aid by tax year */}
              {submissions.length > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                  <h2 className="font-semibold text-brand-primary mb-1">Gift Aid Claimed by Tax Year</h2>
                  <p className="text-xs text-gray-400 mb-6">Total Gift Aid reclaimed from HMRC</p>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart barCategoryGap="28%" data={byTaxYear} margin={{ top: 12, right: 20, left: 0, bottom: 16 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
                      <XAxis axisLine={false} tickLine={false} tickMargin={12} minTickGap={24} dataKey="taxYear" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis axisLine={false} tickLine={false} tickMargin={10} width={72} tickFormatter={v => `£${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: '#64748b' }} />
                      <Tooltip cursor={{ fill: '#f1f5f9', radius: 6 }} content={<CurrencyInsightTooltip />} />
                      <Bar maxBarSize={44} dataKey="giftAid" name="Gift Aid" fill={TEAL} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Avg Gift Aid per donor */}
              {totalDonorCount > 0 && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8">
                  <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                    <div>
                      <h2 className="font-semibold text-brand-primary mb-1">Average Gift Aid per Donor</h2>
                      <p className="text-xs text-gray-400">By tax year</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Overall average</p>
                      <p className="text-2xl font-bold text-brand-accent">{fmt(avgGiftAidPerDonor)}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{totalDonorCount} donor{totalDonorCount !== 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart barCategoryGap="28%" data={avgPerDonorByYear} margin={{ top: 12, right: 20, left: 0, bottom: 16 }}>
                      <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 5" />
                      <XAxis axisLine={false} tickLine={false} tickMargin={12} minTickGap={24} dataKey="taxYear" tick={{ fontSize: 12, fill: '#64748b' }} />
                      <YAxis axisLine={false} tickLine={false} tickMargin={10} width={72} tickFormatter={v => `£${v.toFixed(0)}`} tick={{ fontSize: 12, fill: '#64748b' }} />
                      <Tooltip cursor={{ fill: '#f1f5f9', radius: 6 }} content={<CurrencyInsightTooltip />} />
                      <Bar maxBarSize={44} dataKey="avgGiftAid" name="Avg Gift Aid per donor" fill={NAVY} radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
