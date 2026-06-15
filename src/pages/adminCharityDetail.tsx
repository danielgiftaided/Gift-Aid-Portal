import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useParams, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

interface Charity { id: string; name: string; contact_email: string; charity_number: string | null }
interface Submission { id: string; submission_date: string; status: string; hmrc_reference: string | null; amount_claimed: number; number_of_donations: number; tax_year: string }

interface ParsedRow {
  rowNum: number
  title: string
  firstName: string
  lastName: string
  address: string
  postcode: string
  donationDate: string
  amount: number | null
  giftAidOptIn: string          // raw value from column
  status: 'valid' | 'incomplete' | 'opt_out'
  missingFields: string[]
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

// ── Helpers ──────────────────────────────────────────────
function getTaxYearForDate(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`
}

function parseDonationDate(str: string): Date | null {
  if (!str) return null
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]))
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]))
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

function getTaxYearFromRows(rows: ParsedRow[]): string {
  const counts: Record<string, number> = {}
  for (const r of rows) {
    const d = parseDonationDate(r.donationDate)
    if (d) { const ty = getTaxYearForDate(d); counts[ty] = (counts[ty] || 0) + 1 }
  }
  if (!Object.keys(counts).length) return getTaxYearForDate(new Date())
  return Object.entries(counts).reduce((a, b) => b[1] > a[1] ? b : a)[0]
}

function categoriseRow(row: Omit<ParsedRow, 'status' | 'missingFields'>): Pick<ParsedRow, 'status' | 'missingFields'> {
  const opt = row.giftAidOptIn.trim().toUpperCase()

  if (opt === 'N') return { status: 'opt_out', missingFields: [] }

  // Check mandatory fields
  const missing: string[] = []
  if (!row.firstName) missing.push('First Name')
  if (!row.lastName)  missing.push('Last Name')
  if (!row.address)   missing.push('Address')
  if (!row.postcode)  missing.push('Postcode')
  if (!row.donationDate) missing.push('Donation Date')
  if (!row.amount || row.amount <= 0) missing.push('Amount')

  if (missing.length > 0) return { status: 'incomplete', missingFields: missing }
  return { status: 'valid', missingFields: [] }
}

function parseExcel(file: File): Promise<ParsedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'dd/mm/yyyy' })

        if (rawRows.length < 2) { resolve([]); return }

        const headers = (rawRows[0] as any[]).map(h => String(h || '').toLowerCase().trim())
        const col: Record<string, number | undefined> = {}

        headers.forEach((h, i) => {
          if (h === 'title') col.title = i
          if (['first name','firstname','first_name'].includes(h)) col.firstName = i
          if (['last name','lastname','last_name','surname'].includes(h)) col.lastName = i
          if (h === 'address') col.address = i
          if (['postcode','post code','post_code'].includes(h)) col.postcode = i
          if (['donation date','donationdate','donation_date','date'].includes(h)) col.donationDate = i
          if (['amount','donation amount','donation_amount'].includes(h)) col.amount = i
          if (['gift aid opt in','gift_aid_opt_in','giftaidoptin','opt in','opt_in'].includes(h)) col.giftAidOptIn = i
        })

        const rows: ParsedRow[] = []
        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i] as any[]
          if (!row || row.every(c => !c && c !== 0)) continue

          const get = (k: keyof typeof col) => col[k] !== undefined ? String(row[col[k]!] ?? '').trim() : ''
          const amtRaw = col.amount !== undefined ? row[col.amount] : ''
          const amount = parseFloat(String(amtRaw).replace(/[£,\s]/g, ''))

          const base = {
            rowNum: i + 1,
            title: get('title'),
            firstName: get('firstName'),
            lastName: get('lastName'),
            address: get('address'),
            postcode: get('postcode'),
            donationDate: get('donationDate'),
            amount: isNaN(amount) ? null : amount,
            giftAidOptIn: get('giftAidOptIn'),
          }

          const { status, missingFields } = categoriseRow(base)
          rows.push({ ...base, status, missingFields })
        }

        resolve(rows)
      } catch (err: any) { reject(err) }
    }
    reader.readAsArrayBuffer(file)
  })
}

const statusColor = (s: string) => {
  if (s === 'approved') return 'bg-green-100 text-green-700'
  if (s === 'rejected') return 'bg-red-100 text-red-700'
  if (s === 'submitted') return 'bg-blue-100 text-blue-700'
  return 'bg-yellow-100 text-yellow-700'
}

// ── Component ────────────────────────────────────────────
export default function AdminCharityDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [charity, setCharity] = useState<Charity | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => { if (id) loadData() }, [id])

  const loadData = async () => {
    try {
      setPageError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: charityData, error: cErr } = await supabase.from('charities').select('id, name, contact_email, charity_number').eq('id', id).single()
      if (cErr) throw new Error(cErr.message)
      setCharity(charityData)
      const { data: subData } = await supabase.from('submissions').select('id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year').eq('charity_id', id).order('submission_date', { ascending: false })
      setSubmissions(subData || [])
    } catch (e: any) { setPageError(e.message) } finally { setLoading(false) }
  }

  const handleUpdateStatus = async (submissionId: string, newStatus: string) => {
    setUpdatingId(submissionId)
    const { error } = await supabase.from('submissions').update({ status: newStatus }).eq('id', submissionId)
    if (error) setPageError(error.message)
    else setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, status: newStatus } : s))
    setUpdatingId(null)
  }

  const handleDelete = async (submissionId: string) => {
    if (!window.confirm('Are you sure you want to delete this submission?')) return
    setDeletingId(submissionId)
    const { error } = await supabase.from('submissions').delete().eq('id', submissionId)
    if (error) setPageError(error.message)
    else setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    setDeletingId(null)
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setFileName(file.name); setParsedRows([]); setSubmitSuccess(false); setSubmitError(null)
    try {
      const rows = await parseExcel(file)
      setParsedRows(rows)
    } catch (err: any) {
      setSubmitError(`Could not read the file: ${err.message}`)
    }
  }

  const handleSubmit = async () => {
    if (!parsedRows.length) return
    try {
      setSubmitting(true); setSubmitError(null)

      const validRows    = parsedRows.filter(r => r.status === 'valid')
      const incompleteRows = parsedRows.filter(r => r.status === 'incomplete')
      const optOutRows   = parsedRows.filter(r => r.status === 'opt_out')

      const taxYear = getTaxYearFromRows(validRows.length ? validRows : parsedRows)
      let submissionId: string | null = null

      // Create HMRC submission only if there are valid rows
      if (validRows.length > 0) {
        const totalDonations = validRows.reduce((s, r) => s + (r.amount ?? 0), 0)
        const giftAid = Math.round(totalDonations * 0.25 * 100) / 100

        const { data: newSub, error: subErr } = await supabase.from('submissions').insert({
          charity_id: id, submission_date: new Date().toISOString().split('T')[0],
          tax_year: taxYear, amount_claimed: giftAid,
          number_of_donations: validRows.length, status: 'pending',
        }).select('id').single()
        if (subErr || !newSub) throw new Error(subErr?.message || 'Failed to create submission')
        submissionId = newSub.id

        // Insert into donations table
        await supabase.from('donations').insert(
          validRows.map(r => ({
            submission_id: submissionId, charity_id: id,
            title: r.title || null, first_name: r.firstName, last_name: r.lastName,
            address: r.address, postcode: r.postcode, donation_date: r.donationDate, amount: r.amount,
          }))
        )
      }

      // Save ALL rows to uploaded_records for insights
      const allRecords = parsedRows.map(r => ({
        charity_id: id,
        submission_id: r.status === 'valid' ? submissionId : null,
        title: r.title || null,
        first_name: r.firstName || null,
        last_name: r.lastName || null,
        address: r.address || null,
        postcode: r.postcode || null,
        donation_date: r.donationDate || null,
        amount: r.amount ?? null,
        gift_aid_opt_in: r.giftAidOptIn || null,
        record_status: r.status,
        tax_year: taxYear,
      }))
      const { error: recErr } = await supabase.from('uploaded_records').insert(allRecords)
      if (recErr) throw new Error(recErr.message)

      setSubmitSuccess(true)
      setParsedRows([]); setFileName('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadData()
    } catch (e: any) { setSubmitError(e.message) } finally { setSubmitting(false) }
  }

  const validRows      = parsedRows.filter(r => r.status === 'valid')
  const incompleteRows = parsedRows.filter(r => r.status === 'incomplete')
  const optOutRows     = parsedRows.filter(r => r.status === 'opt_out')

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

  const totalGiftAid = submissions.reduce((s, r) => s + (parseFloat(String(r.amount_claimed)) || 0), 0)

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
            <Logo />
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-brand-primary">{charity?.name}</h1>
              <p className="text-gray-400 text-sm mt-1">{charity?.contact_email}{charity?.charity_number && ` · ${charity.charity_number}`}</p>
            </div>
            <button
              onClick={() => navigate(`/admin/charities/${id}/insights`)}
              className="flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-accent text-white hover:opacity-90 transition-opacity"
            >
              View Insights
            </button>
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12 space-y-6">
          {pageError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{pageError}</div>}

          {/* Summary cards */}
          {submissions.length > 0 && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                { label: 'Total Donations', value: `£${(totalGiftAid * 4).toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-primary' },
                { label: 'Total Gift Aid',  value: `£${totalGiftAid.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`, color: 'text-brand-accent' },
                { label: 'Submissions',     value: String(submissions.length), color: 'text-brand-primary' },
                { label: 'Approved',        value: String(submissions.filter(s => s.status === 'approved').length), color: 'text-green-600' },
              ].map(c => (
                <div key={c.label} className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-5">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{c.label}</div>
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Submissions table */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50"><h2 className="font-semibold text-brand-primary">Submissions</h2></div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-50">
                <thead><tr className="bg-gray-50/50">{['Date','Tax Year','Amount','Donations','Status','HMRC Ref','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {submissions.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-300">No submissions yet</td></tr>
                  ) : submissions.map(s => (
                    <tr key={s.id} className="hover:bg-brand-surface/40 cursor-pointer transition-colors"
                      onClick={() => navigate(`/submissions/${s.id}`, { state: { backUrl: `/admin/charities/${id}` } })}>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{new Date(s.submission_date).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{s.tax_year}</td>
                      <td className="px-4 py-3 text-sm font-bold text-brand-accent whitespace-nowrap">£{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.number_of_donations}</td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <select value={s.status} disabled={updatingId === s.id} onChange={e => handleUpdateStatus(s.id, e.target.value)}
                          className={`text-xs font-semibold rounded px-2 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-brand-accent ${statusColor(s.status)}`}>
                          <option value="pending">Pending</option><option value="submitted">Submitted</option>
                          <option value="approved">Approved</option><option value="rejected">Rejected</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono whitespace-nowrap">{s.hmrc_reference || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleDelete(s.id)} disabled={deletingId === s.id} className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40">
                          {deletingId === s.id ? 'Deleting…' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Upload section */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <h2 className="font-semibold text-brand-primary mb-1">Upload Donation Spreadsheet</h2>
            <p className="text-sm text-gray-400 mb-1">Upload an Excel file (.xlsx). Rows are automatically sorted by Gift Aid Opt In status.</p>
            <p className="text-xs text-gray-300 mb-4">
              Required columns: <span className="font-medium text-gray-400">First Name, Last Name, Address, Postcode, Donation Date, Amount, Gift Aid Opt In</span> — Title is optional
            </p>

            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange}
              className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-brand-accent file:text-white hover:file:opacity-90 mb-4" />

            {/* Category breakdown */}
            {parsedRows.length > 0 && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Valid for HMRC', count: validRows.length, color: 'border-green-400 text-green-700 bg-green-50' },
                  { label: 'Incomplete', count: incompleteRows.length, color: 'border-yellow-400 text-yellow-700 bg-yellow-50' },
                  { label: 'Gift Aid Opt Out', count: optOutRows.length, color: 'border-gray-300 text-gray-500 bg-gray-50' },
                ].map(c => (
                  <div key={c.label} className={`rounded-lg border-l-4 p-3 ${c.color}`}>
                    <div className="text-2xl font-bold">{c.count}</div>
                    <div className="text-xs font-medium mt-0.5">{c.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Valid rows preview */}
            {validRows.length > 0 && (
              <div className="mb-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Valid rows — Gift Aid value: £{(validRows.reduce((s, r) => s + (r.amount ?? 0), 0) * 0.25).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</p>
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-100 text-sm">
                    <thead className="bg-gray-50"><tr>{['First Name','Last Name','Address','Postcode','Date','Amount'].map(h => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase">{h}</th>)}</tr></thead>
                    <tbody className="divide-y divide-gray-50">
                      {validRows.slice(0, 5).map(r => (
                        <tr key={r.rowNum}>
                          <td className="px-3 py-2">{r.firstName}</td><td className="px-3 py-2">{r.lastName}</td>
                          <td className="px-3 py-2">{r.address}</td><td className="px-3 py-2">{r.postcode}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{r.donationDate}</td>
                          <td className="px-3 py-2 font-medium text-brand-accent">£{(r.amount ?? 0).toFixed(2)}</td>
                        </tr>
                      ))}
                      {validRows.length > 5 && <tr><td colSpan={6} className="px-3 py-2 text-center text-gray-300 text-xs italic">… and {validRows.length - 5} more</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Incomplete rows preview */}
            {incompleteRows.length > 0 && (
              <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-yellow-700 uppercase tracking-wide mb-2">{incompleteRows.length} incomplete row{incompleteRows.length !== 1 ? 's' : ''} — missing mandatory fields</p>
                <ul className="space-y-1">
                  {incompleteRows.slice(0, 5).map(r => (
                    <li key={r.rowNum} className="text-xs text-yellow-700">
                      Row {r.rowNum}: {r.firstName || r.lastName ? `${r.firstName} ${r.lastName} — ` : ''}missing {r.missingFields.join(', ')}
                    </li>
                  ))}
                  {incompleteRows.length > 5 && <li className="text-xs text-yellow-600 italic">… and {incompleteRows.length - 5} more</li>}
                </ul>
              </div>
            )}

            {/* Opt-out summary */}
            {optOutRows.length > 0 && (
              <div className="mb-4 bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {optOutRows.length} donor{optOutRows.length !== 1 ? 's' : ''} opted out of Gift Aid — these will be saved for reporting but not submitted to HMRC
                </p>
              </div>
            )}

            {submitSuccess && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">Upload complete. {validRows.length > 0 ? `${validRows.length} valid donation${validRows.length !== 1 ? 's' : ''} submitted to Gift Aid.` : 'No valid rows to submit.'}</div>}
            {submitError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{submitError}</div>}

            <button onClick={handleSubmit} disabled={submitting || parsedRows.length === 0}
              className="bg-brand-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
              {submitting ? 'Uploading…' : `Upload ${parsedRows.length > 0 ? `(${parsedRows.length} rows)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
