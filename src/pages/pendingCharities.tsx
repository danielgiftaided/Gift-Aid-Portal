import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'

interface PendingCharity {
  id: string
  email: string
  status: 'pending' | 'completed'
  invited_at: string
}

interface ParsedRow {
  rowNum: number
  title: string
  firstName: string
  lastName: string
  address: string
  postcode: string
  donationDate: string
  amount: number | null
  giftAidOptIn: string
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

// ── Helpers (same logic as adminCharityDetail) ──────────────
function categoriseRow(row: Omit<ParsedRow, 'status' | 'missingFields'>): Pick<ParsedRow, 'status' | 'missingFields'> {
  const opt = row.giftAidOptIn.trim().toUpperCase()
  if (opt === 'N') return { status: 'opt_out', missingFields: [] }
  const missing: string[] = []
  if (!row.firstName) missing.push('First Name')
  if (!row.lastName) missing.push('Last Name')
  if (!row.address) missing.push('Address')
  if (!row.postcode) missing.push('Postcode')
  if (!row.donationDate) missing.push('Donation Date')
  if (!row.amount || row.amount <= 0) missing.push('Amount')
  if (missing.length > 0) return { status: 'incomplete', missingFields: missing }
  return { status: 'valid', missingFields: [] }
}

function getTaxYearForDate(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`
}
function parseDonationDate(str: string): Date | null {
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
            rowNum: i + 1, title: get('title'), firstName: get('firstName'), lastName: get('lastName'),
            address: get('address'), postcode: get('postcode'), donationDate: get('donationDate'),
            amount: isNaN(amount) ? null : amount, giftAidOptIn: get('giftAidOptIn'),
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

export default function PendingCharities() {
  const navigate = useNavigate()
  const [pendingList, setPendingList] = useState<PendingCharity[]>([])
  const [stagedCounts, setStagedCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Upload modal state
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    try {
      setError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }

      const { data: pending, error: pendErr } = await supabase
        .from('pending_charities')
        .select('id, email, status, invited_at')
        .eq('status', 'pending')
        .order('invited_at', { ascending: false })
      if (pendErr) throw new Error(pendErr.message)
      setPendingList(pending || [])

      if (pending && pending.length > 0) {
        // Use a count query per email — exact counts regardless of how many
        // rows exist, without pulling the row data just to tally it client-side.
        const counts: Record<string, number> = {}
        await Promise.all(
          pending.map(async (p) => {
            const { count } = await supabase
              .from('pending_uploaded_records')
              .select('id', { count: 'exact', head: true })
              .eq('pending_email', p.email)
            counts[p.email] = count ?? 0
          })
        )
        setStagedCounts(counts)
      }
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setParsedRows([]); setSubmitSuccess(false); setSubmitError(null)
    try {
      const rows = await parseExcel(file)
      setParsedRows(rows)
    } catch (err: any) {
      setSubmitError(`Could not read the file: ${err.message}`)
    }
  }

  const handleStage = async () => {
    if (!uploadingFor || !parsedRows.length) return
    try {
      setSubmitting(true); setSubmitError(null)

      // Compute each row's OWN tax year from its own donation date —
      // a staged batch can span multiple tax years.
      const { error: insertErr } = await supabase.from('pending_uploaded_records').insert(
        parsedRows.map(r => {
          const parsedDate = parseDonationDate(r.donationDate)
          const taxYear = parsedDate ? getTaxYearForDate(parsedDate) : getTaxYearForDate(new Date())
          return {
            pending_email: uploadingFor,
            title: r.title || null,
            first_name: r.firstName || null,
            last_name: r.lastName || null,
            address: r.address || null,
            postcode: r.postcode || null,
            donation_date: r.donationDate || null,
            amount: r.amount,
            gift_aid_opt_in: r.giftAidOptIn || null,
            record_status: r.status,
            tax_year: taxYear,
          }
        })
      )
      if (insertErr) throw new Error(insertErr.message)

      setSubmitSuccess(true)
      setParsedRows([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      await loadData()
    } catch (e: any) { setSubmitError(e.message) } finally { setSubmitting(false) }
  }

  const closeModal = () => {
    setUploadingFor(null); setParsedRows([]); setSubmitSuccess(false); setSubmitError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const validCount = parsedRows.filter(r => r.status === 'valid').length
  const incompleteCount = parsedRows.filter(r => r.status === 'incomplete').length
  const optOutCount = parsedRows.filter(r => r.status === 'opt_out').length

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

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
          <h1 className="text-3xl font-bold text-brand-primary">Pending Charities</h1>
          <p className="text-gray-400 text-sm mt-1">Charities who have been invited but haven't completed signup yet. You can stage donation data for them now — it will move into their account automatically the moment they finish setting up their profile.</p>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-brand-primary">Awaiting Signup</h2>
              <span className="text-xs text-gray-400">{pendingList.length} pending</span>
            </div>
            {pendingList.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-300">No pending charities right now.</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {pendingList.map(p => (
                  <li key={p.id} className="px-6 py-4 flex items-center justify-between hover:bg-brand-surface/40 transition-colors">
                    <div>
                      <div className="font-semibold text-brand-primary">{p.email}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        Invited {new Date(p.invited_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {stagedCounts[p.email] > 0 && (
                          <span className="ml-2 text-brand-accent font-medium">· {stagedCounts[p.email]} row{stagedCounts[p.email] !== 1 ? 's' : ''} staged</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/admin/pending-charities/${encodeURIComponent(p.email)}/insights`)}
                        disabled={!stagedCounts[p.email]}
                        title={!stagedCounts[p.email] ? 'Upload data first to see insights' : 'View insights'}
                        className="px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-brand-primary"
                      >
                        Insights
                      </button>
                      <button
                        onClick={() => setUploadingFor(p.email)}
                        className="px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-accent/30 text-brand-accent hover:bg-brand-accent hover:text-white transition-colors"
                      >
                        Upload Data
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Upload modal */}
      {uploadingFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">Stage data for {uploadingFor}</h3>
                <p className="text-xs text-gray-400 mt-0.5">This will be saved and automatically moved into their account once they complete signup.</p>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="p-6">
              <p className="text-xs text-gray-300 mb-4">
                Required columns: <span className="font-medium text-gray-400">First Name, Last Name, Address, Postcode, Donation Date, Amount, Gift Aid Opt In</span> — Title is optional
              </p>

              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" onChange={handleFileChange}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-brand-accent file:text-white hover:file:opacity-90 mb-4" />

              {parsedRows.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Valid', count: validCount, color: 'border-green-400 text-green-700 bg-green-50' },
                    { label: 'Incomplete', count: incompleteCount, color: 'border-yellow-400 text-yellow-700 bg-yellow-50' },
                    { label: 'Opt Out', count: optOutCount, color: 'border-gray-300 text-gray-500 bg-gray-50' },
                  ].map(c => (
                    <div key={c.label} className={`rounded-lg border-l-4 p-3 ${c.color}`}>
                      <div className="text-2xl font-bold">{c.count}</div>
                      <div className="text-xs font-medium mt-0.5">{c.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {submitSuccess && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-4 text-sm">Data staged successfully. It will be applied automatically once this charity completes signup.</div>}
              {submitError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{submitError}</div>}

              <div className="flex justify-end gap-3">
                <button onClick={closeModal} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700">Close</button>
                <button onClick={handleStage} disabled={submitting || parsedRows.length === 0}
                  className="bg-brand-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  {submitting ? 'Staging…' : `Stage ${parsedRows.length > 0 ? `(${parsedRows.length} rows)` : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
