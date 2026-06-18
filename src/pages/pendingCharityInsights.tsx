import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'

interface PendingRecord {
  id: string
  title: string | null
  first_name: string | null
  last_name: string | null
  postcode: string | null
  donation_date: string | null
  amount: number | null
  record_status: 'valid' | 'incomplete' | 'opt_out'
  tax_year: string | null
  created_at: string
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

const TEAL = '#0c745d'; const AMBER = '#f59e0b'; const SLATE = '#94a3b8'; const NAVY = '#304675'

function fmt(v: number) { return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }

// Recomputes the tax year from each row's own donation date rather than
// trusting the stored tax_year column — this makes the page self-correcting
// for any rows staged before the per-row tax year fix went live.
function parseDonationDate(str: string | null): Date | null {
  if (!str) return null
  const trimmed = str.trim()

  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10), year = parseInt(dmy[3], 10)
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

function getTaxYearForDate(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`
}

/** Resolves the correct tax year for a record — prefers the donation date,
 *  falls back to the stored tax_year column only if the date can't be parsed. */
function effectiveTaxYear(r: PendingRecord): string {
  const parsed = parseDonationDate(r.donation_date)
  if (parsed) return getTaxYearForDate(parsed)
  return r.tax_year || getTaxYearForDate(new Date())
}

// Supabase/PostgREST caps a single response at 1000 rows by default.
// This loops through in batches until every row has been fetched.
async function fetchAllPendingRecords(email: string): Promise<PendingRecord[]> {
  const PAGE_SIZE = 1000
  let all: PendingRecord[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('pending_uploaded_records')
      .select('id, title, first_name, last_name, postcode, donation_date, amount, record_status, tax_year, created_at')
      .eq('pending_email', email)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break

    all = all.concat(data as PendingRecord[])
    if (data.length < PAGE_SIZE) break // last page reached
    from += PAGE_SIZE
  }

  return all
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-lg px-4 py-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>{p.name}: {typeof p.value === 'number' && p.value > 10 ? fmt(p.value) : p.value}</p>
      ))}
    </div>
  )
}

export default function PendingCharityInsights() {
  const { email: encodedEmail } = useParams<{ email: string }>()
  const email = decodeURIComponent(encodedEmail || '')
  const navigate = useNavigate()
  const [records, setRecords] = useState<PendingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (email) loadData() }, [email])

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const allRecords = await fetchAllPendingRecords(email)
      setRecords(allRecords)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  // ── Calculations ──────────────────────────────────────
  const validRecords      = records.filter(r => r.record_status === 'valid')
  const incompleteRecords = records.filter(r => r.record_status === 'incomplete')
  const optOutRecords     = records.filter(r => r.record_status === 'opt_out')
  const totalRecords      = records.length

  const totalDonationValue = validRecords.reduce((s, r) => s + (parseFloat(String(r.amount)) || 0), 0)
  const potentialGiftAid   = totalDonationValue * 0.25
  const avgGiftAidPerDonor = validRecords.length > 0 ? potentialGiftAid / validRecords.length : 0

  const taxYears = [...new Set(records.map(r => effectiveTaxYear(r)))].sort()

  const recordsByYear = taxYears.map(ty => ({
    taxYear: ty,
    valid:      records.filter(r => effectiveTaxYear(r) === ty && r.record_status === 'valid').length,
    incomplete: records.filter(r => effectiveTaxYear(r) === ty && r.record_status === 'incomplete').length,
    optOut:     records.filter(r => effectiveTaxYear(r) === ty && r.record_status === 'opt_out').length,
  }))

  const giftAidByYear = taxYears.map(ty => {
    const yearValid = validRecords.filter(r => effectiveTaxYear(r) === ty)
    const yearTotal = yearValid.reduce((s, r) => s + (parseFloat(String(r.amount)) || 0), 0)
    return { taxYear: ty, giftAid: Math.round(yearTotal * 0.25 * 100) / 100 }
  })

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>

        <nav className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Logo />
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-4">
          <button onClick={() => navigate('/admin/pending-charities')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Pending Charities</button>
          <h1 className="text-3xl font-bold text-brand-primary">Staged Data Insights</h1>
          <p className="text-gray-400 text-sm mt-1">{email} · awaiting signup completion</p>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6 text-sm">{error}</div>}

          {totalRecords === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-12 text-center">
              <p className="text-gray-300 text-lg">No data staged yet for this email</p>
              <p className="text-gray-300 text-sm mt-1">Upload a spreadsheet from the Pending Charities page to see insights here</p>
            </div>
          ) : (
            <div className="space-y-6">

              {/* Notice banner */}
              <div className="bg-amber-50 border border-amber-200 text-amber-700 px-4 py-3 rounded-lg text-sm">
                This data hasn't been submitted to HMRC yet. It will automatically move into a live submission the moment this charity completes signup.
              </div>

              {/* Summary strip */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Total records staged',      value: String(totalRecords) },
                  { label: 'Potential Gift Aid value',  value: fmt(potentialGiftAid) },
                  { label: 'Avg Gift Aid / donor',      value: validRecords.length > 0 ? fmt(avgGiftAidPerDonor) : '—' },
                  { label: 'Tax years represented',     value: String(taxYears.length) },
                ].map(c => (
                  <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className="text-2xl font-bold text-brand-primary">{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Headline record breakdown */}
              <div className="grid grid-cols-3 gap-4">
                {[
                  { label: 'Valid for Gift Aid', value: validRecords.length,      sub: 'Will be submitted to HMRC',  border: 'border-brand-accent', text: 'text-brand-accent' },
                  { label: 'Incomplete records', value: incompleteRecords.length, sub: 'Missing mandatory fields',   border: 'border-yellow-400',   text: 'text-yellow-600' },
                  { label: 'Gift Aid opt outs',  value: optOutRecords.length,     sub: 'Opted out — won\'t be claimed', border: 'border-gray-300',  text: 'text-gray-500' },
                ].map(c => (
                  <div key={c.label} className={`bg-white rounded-xl border-l-4 border-t border-r border-b border-gray-100 shadow-sm p-5 ${c.border}`}>
                    <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                    <div className={`text-3xl font-bold ${c.text}`}>{c.value}</div>
                    <div className="text-xs text-gray-400 mt-1">{c.sub}</div>
                    {totalRecords > 0 && <div className="text-xs text-gray-300 mt-0.5">{Math.round(c.value / totalRecords * 100)}% of staged records</div>}
                  </div>
                ))}
              </div>

              {/* Record breakdown by tax year */}
              {recordsByYear.length > 0 && (
                <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                  <h2 className="font-semibold text-brand-primary mb-1">Record Breakdown by Tax Year</h2>
                  <p className="text-xs text-gray-400 mb-6">Valid, incomplete and opt-out records across each tax year represented in the staged data</p>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={recordsByYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="valid"      name="Valid"      fill={TEAL}  stackId="a" radius={[0,0,0,0]} />
                      <Bar dataKey="incomplete" name="Incomplete" fill={AMBER} stackId="a" radius={[0,0,0,0]} />
                      <Bar dataKey="optOut"     name="Opt out"   fill={SLATE} stackId="a" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Potential Gift Aid by tax year */}
              {giftAidByYear.length > 0 && validRecords.length > 0 && (
                <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
                  <h2 className="font-semibold text-brand-primary mb-1">Potential Gift Aid by Tax Year</h2>
                  <p className="text-xs text-gray-400 mb-6">What this charity stands to claim once their account is live — based on valid rows only</p>
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={giftAidByYear} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="taxYear" tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <YAxis tickFormatter={v => `£${v.toFixed(0)}`} tick={{ fontSize: 12, fill: '#9ca3af' }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Bar dataKey="giftAid" name="Potential Gift Aid" fill={NAVY} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Incomplete rows detail */}
              {incompleteRecords.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
                  <h2 className="font-semibold text-brand-primary mb-1">Incomplete Records</h2>
                  <p className="text-xs text-gray-400 mb-4">These rows are missing mandatory fields and won't be submitted to HMRC until corrected</p>
                  <div className="overflow-x-auto border border-gray-100 rounded-lg">
                    <table className="min-w-full divide-y divide-gray-100 text-sm">
                      <thead className="bg-gray-50"><tr>
                        {['Name', 'Postcode', 'Date', 'Amount'].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>)}
                      </tr></thead>
                      <tbody className="divide-y divide-gray-50">
                        {incompleteRecords.slice(0, 10).map(r => (
                          <tr key={r.id}>
                            <td className="px-3 py-2">{[r.title, r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                            <td className="px-3 py-2">{r.postcode || '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{r.donation_date || '—'}</td>
                            <td className="px-3 py-2">{r.amount ? `£${parseFloat(String(r.amount)).toFixed(2)}` : '—'}</td>
                          </tr>
                        ))}
                        {incompleteRecords.length > 10 && (
                          <tr><td colSpan={4} className="px-3 py-2 text-center text-gray-300 text-xs italic">… and {incompleteRecords.length - 10} more</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

            </div>
          )}
        </div>
      </div>
    </div>
  )
}
