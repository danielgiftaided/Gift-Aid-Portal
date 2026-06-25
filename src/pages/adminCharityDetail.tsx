import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useParams, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import { fetchAllRows } from '../utils/fetchAll'

interface Charity { id: string; name: string; contact_email: string; charity_number: string | null; charity_id: string | null; authorised_official_name: string | null; agent_nominee_reference: string | null }
interface Submission { id: string; submission_date: string; status: string; hmrc_reference: string | null; amount_claimed: number; number_of_donations: number; tax_year: string; hmrc_status: string; hmrc_response_message: string | null; hmrc_claim_xml: string | null }

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
  const trimmed = str.trim()

  // DD/MM/YYYY (UK standard) — validate ranges and reject silent rollovers
  // (e.g. "31/02/2024" must not become "2 March 2024")
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10)
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day)
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    }
  }

  // YYYY-MM-DD (ISO)
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) {
    const year = parseInt(ymd[1], 10), month = parseInt(ymd[2], 10), day = parseInt(ymd[3], 10)
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
  }

  // Fallback — let JS attempt to parse directly (handles things like "6 April 2024")
  const fallback = new Date(trimmed)
  return isNaN(fallback.getTime()) ? null : fallback
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
  const [buildingId, setBuildingId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [buildResult, setBuildResult] = useState<{ submissionId: string; ok: boolean; message: string; errors?: string[]; warnings?: string[] } | null>(null)
  const [viewingXmlFor, setViewingXmlFor] = useState<Submission | null>(null)
  const [agentRefInput, setAgentRefInput] = useState('')
  const [savingAgentRef, setSavingAgentRef] = useState(false)
  const [agentRefSaved, setAgentRefSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'submissions' | 'chv1'>('submissions')
  const [authOfficialInput, setAuthOfficialInput] = useState('')
  const [savingAuthOfficial, setSavingAuthOfficial] = useState(false)
  const [authOfficialSaved, setAuthOfficialSaved] = useState(false)

  useEffect(() => { if (id) loadData() }, [id])

  const loadData = async () => {
    try {
      setPageError(null)
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const { data: charityData, error: cErr } = await supabase.from('charities').select('id, name, contact_email, charity_number, charity_id, authorised_official_name, agent_nominee_reference').eq('id', id).single()
      if (cErr) throw new Error(cErr.message)
      setCharity(charityData)
      setAgentRefInput(charityData?.agent_nominee_reference || '')
      setAuthOfficialInput(charityData?.authorised_official_name || '')
      const subData = await fetchAllRows<Submission>(() =>
        supabase.from('submissions').select('id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year, hmrc_status, hmrc_response_message, hmrc_claim_xml').eq('charity_id', id).order('submission_date', { ascending: false })
      )
      setSubmissions(subData)
    } catch (e: any) { setPageError(e.message) } finally { setLoading(false) }
  }

  const handleUpdateStatus = async (submissionId: string, newStatus: string) => {
    setUpdatingId(submissionId)
    const { error } = await supabase.from('submissions').update({ status: newStatus }).eq('id', submissionId)
    if (error) setPageError(error.message)
    else setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, status: newStatus } : s))
    setUpdatingId(null)
  }

  const handleSaveAgentRef = async () => {
    setSavingAgentRef(true)
    setAgentRefSaved(false)
    const trimmed = agentRefInput.trim()
    const { error } = await supabase.from('charities').update({ agent_nominee_reference: trimmed || null }).eq('id', id)
    if (error) {
      setPageError(error.message)
    } else {
      setCharity(prev => prev ? { ...prev, agent_nominee_reference: trimmed || null } : prev)
      setAgentRefSaved(true)
      setTimeout(() => setAgentRefSaved(false), 3000)
    }
    setSavingAgentRef(false)
  }

  const handleSaveAuthOfficial = async () => {
    setSavingAuthOfficial(true)
    setAuthOfficialSaved(false)
    const trimmed = authOfficialInput.trim()
    const { error } = await supabase.from('charities').update({ authorised_official_name: trimmed || null }).eq('id', id)
    if (error) {
      setPageError(error.message)
    } else {
      setCharity(prev => prev ? { ...prev, authorised_official_name: trimmed || null } : prev)
      setAuthOfficialSaved(true)
      setTimeout(() => setAuthOfficialSaved(false), 3000)
    }
    setSavingAuthOfficial(false)
  }

  const handleDelete = async (submissionId: string) => {
    if (!window.confirm('Are you sure you want to delete this submission?')) return
    setDeletingId(submissionId)
    const { error } = await supabase.from('submissions').delete().eq('id', submissionId)
    if (error) setPageError(error.message)
    else setSubmissions(prev => prev.filter(s => s.id !== submissionId))
    setDeletingId(null)
  }

  const handleBuildClaim = async (submissionId: string) => {
    setBuildingId(submissionId)
    setBuildResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setPageError('Your session has expired — please refresh and log in again.'); return }

      const resp = await fetch('/api/admin/submitClaim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const json = await resp.json()

      if (!resp.ok) {
        setBuildResult({ submissionId, ok: false, message: json.error || 'Failed to build claim', errors: json.errors || [] })
      } else {
        setBuildResult({ submissionId, ok: true, message: json.message, warnings: json.warnings || [] })
      }
      await loadData() // refresh to pick up the new hmrc_status / hmrc_claim_xml
    } catch (e: any) {
      setBuildResult({ submissionId, ok: false, message: e.message, errors: [] })
    } finally {
      setBuildingId(null)
    }
  }

  const handleSendToEts = async (submissionId: string) => {
    if (!window.confirm('This will actually submit the claim to HMRC\'s External Test Service over the network. Continue?')) return
    setSendingId(submissionId)
    setBuildResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setPageError('Your session has expired — please refresh and log in again.'); return }

      const resp = await fetch('/api/admin/sendToEts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const json = await resp.json()

      if (!resp.ok) {
        setBuildResult({ submissionId, ok: false, message: json.error || 'Failed to send to ETS', errors: (json.errors || []).map((e: any) => `[${e.number}] ${e.text}`) })
      } else {
        setBuildResult({ submissionId, ok: true, message: json.message })
      }
      await loadData()
    } catch (e: any) {
      setBuildResult({ submissionId, ok: false, message: e.message, errors: [] })
    } finally {
      setSendingId(null)
    }
  }

  const handleCheckStatus = async (submissionId: string) => {
    setCheckingId(submissionId)
    setBuildResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setPageError('Your session has expired — please refresh and log in again.'); return }

      const resp = await fetch('/api/admin/pollClaim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const json = await resp.json()

      if (!resp.ok) {
        setBuildResult({ submissionId, ok: false, message: json.error || 'Failed to check status', errors: [] })
      } else {
        setBuildResult({ submissionId, ok: true, message: json.message, errors: (json.errors || []).map((e: any) => `[${e.number}] ${e.text}`) })
      }
      await loadData()
    } catch (e: any) {
      setBuildResult({ submissionId, ok: false, message: e.message, errors: [] })
    } finally {
      setCheckingId(null)
    }
  }

  function hmrcStatusBadge(status: string) {
    const styles: Record<string, string> = {
      not_submitted: 'bg-gray-100 text-gray-500',
      validation_failed: 'bg-red-100 text-red-700',
      ready_to_send: 'bg-blue-100 text-blue-700',
      sent: 'bg-amber-100 text-amber-700',
      polling: 'bg-amber-100 text-amber-700',
      accepted: 'bg-green-100 text-green-700',
      rejected: 'bg-red-100 text-red-700',
      error: 'bg-red-100 text-red-700',
    }
    const labels: Record<string, string> = {
      not_submitted: 'Not built',
      validation_failed: 'Validation failed',
      ready_to_send: 'Ready to send',
      sent: 'Sent',
      polling: 'Awaiting response',
      accepted: 'Accepted',
      rejected: 'Rejected',
      error: 'Error',
    }
    return <span className={`text-xs font-semibold px-2 py-1 rounded ${styles[status] || 'bg-gray-100 text-gray-500'}`}>{labels[status] || status}</span>
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

      // Compute each row's OWN tax year from its own donation date —
      // never assume the whole batch shares one tax year.
      const rowsWithTaxYear = parsedRows.map(r => {
        const parsedDate = parseDonationDate(r.donationDate)
        const computedTaxYear = parsedDate ? getTaxYearForDate(parsedDate) : getTaxYearForDate(new Date())
        return { ...r, computedTaxYear }
      })

      const validRows = rowsWithTaxYear.filter(r => r.status === 'valid')

      // Group valid rows by tax year — one submission per tax year present
      const byTaxYear: Record<string, typeof validRows> = {}
      for (const row of validRows) {
        if (!byTaxYear[row.computedTaxYear]) byTaxYear[row.computedTaxYear] = []
        byTaxYear[row.computedTaxYear].push(row)
      }

      // Map of rowNum -> created submission id (valid rows only)
      const submissionIdByRowNum: Record<number, string> = {}

      for (const [taxYear, rows] of Object.entries(byTaxYear)) {
        const totalDonations = rows.reduce((s, r) => s + (r.amount ?? 0), 0)
        const giftAid = Math.round(totalDonations * 0.25 * 100) / 100

        const { data: newSub, error: subErr } = await supabase.from('submissions').insert({
          charity_id: id, submission_date: new Date().toISOString().split('T')[0],
          tax_year: taxYear, amount_claimed: giftAid,
          number_of_donations: rows.length, status: 'pending',
        }).select('id').single()
        if (subErr || !newSub) throw new Error(subErr?.message || 'Failed to create submission')

        for (const row of rows) submissionIdByRowNum[row.rowNum] = newSub.id

        await supabase.from('donations').insert(
          rows.map(r => ({
            submission_id: newSub.id, charity_id: id,
            title: r.title || null, first_name: r.firstName, last_name: r.lastName,
            address: r.address, postcode: r.postcode, donation_date: r.donationDate, amount: r.amount,
          }))
        )
      }

      // Save ALL rows to uploaded_records — each tagged with its OWN tax year,
      // not a single batch-wide guess
      const allRecords = rowsWithTaxYear.map(r => ({
        charity_id: id,
        submission_id: submissionIdByRowNum[r.rowNum] ?? null,
        title: r.title || null,
        first_name: r.firstName || null,
        last_name: r.lastName || null,
        address: r.address || null,
        postcode: r.postcode || null,
        donation_date: r.donationDate || null,
        amount: r.amount ?? null,
        gift_aid_opt_in: r.giftAidOptIn || null,
        record_status: r.status,
        tax_year: r.computedTaxYear,
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

  // Each row's tax year is computed individually from its own donation date —
  // a single upload can span multiple tax years and will create one submission per year.
  const distinctTaxYears = [...new Set(
    validRows.map(r => {
      const d = parseDonationDate(r.donationDate)
      return d ? getTaxYearForDate(d) : getTaxYearForDate(new Date())
    })
  )]

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
            <h1 className="text-3xl font-bold text-brand-primary">{charity?.name}</h1>
            <button
              onClick={() => navigate(`/admin/charities/${id}/insights`)}
              className="flex-shrink-0 px-4 py-2 text-sm font-semibold rounded-lg bg-brand-accent text-white hover:opacity-90 transition-opacity"
            >
              View Insights
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-6 mt-6 border-b border-gray-100">
            {[
              { key: 'submissions' as const, label: 'Submissions' },
              { key: 'chv1' as const, label: 'Charity Information' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`pb-3 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                  activeTab === tab.key
                    ? 'border-brand-accent text-brand-accent'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'chv1' && (
          <div className="max-w-4xl mx-auto px-6 pb-12">
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 max-w-lg">
              <h2 className="font-semibold text-brand-primary mb-1">Charity Information</h2>
              <p className="text-xs text-gray-400 mb-5">Everything needed to complete a ChV1 form for this charity, in one place.</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Contact Email</label>
                  <p className="text-sm text-gray-700">{charity?.contact_email || '—'}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Charity Commission Number</label>
                  <p className="text-sm text-gray-700">{charity?.charity_number || '—'}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">HMRC Charities (Gift Aid) Reference</label>
                  <p className="text-sm text-gray-700">{charity?.charity_id || '—'}</p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Authorised Official's Name</label>
                  <div className="flex items-end gap-3">
                    <input
                      type="text"
                      value={authOfficialInput}
                      onChange={e => setAuthOfficialInput(e.target.value)}
                      placeholder="e.g. Jane Smith"
                      className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                    />
                    <button
                      onClick={handleSaveAuthOfficial}
                      disabled={savingAuthOfficial}
                      className="text-sm font-semibold text-brand-accent hover:text-brand-primary disabled:opacity-40 pb-1.5"
                    >
                      {savingAuthOfficial ? 'Saving…' : authOfficialSaved ? 'Saved ✓' : 'Save'}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">HMRC Agent/Nominee Reference</label>
                  <div className="flex items-end gap-3">
                    <input
                      type="text"
                      value={agentRefInput}
                      onChange={e => setAgentRefInput(e.target.value)}
                      placeholder="Not yet received from HMRC"
                      className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                    />
                    <button
                      onClick={handleSaveAgentRef}
                      disabled={savingAgentRef}
                      className="text-sm font-semibold text-brand-accent hover:text-brand-primary disabled:opacity-40 pb-1.5"
                    >
                      {savingAgentRef ? 'Saving…' : agentRefSaved ? 'Saved ✓' : 'Save'}
                    </button>
                  </div>
                  <p className="text-xs text-gray-300 mt-1">Specific to Gift Aided's relationship with this charity — different for every charity, issued by HMRC separately each time.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'submissions' && (
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
            {buildResult && (
              <div className={`px-6 py-3 text-sm ${buildResult.ok ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                <p className="font-medium">{buildResult.message}</p>
                {buildResult.errors && buildResult.errors.length > 0 && (
                  <ul className="list-disc list-inside mt-1 text-xs">{buildResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                )}
                {buildResult.warnings && buildResult.warnings.length > 0 && (
                  <ul className="list-disc list-inside mt-1 text-xs">{buildResult.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-50">
                <thead><tr className="bg-gray-50/50">{['Date','Tax Year','Amount','Donations','Status','HMRC Ref','HMRC Claim','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {submissions.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-300">No submissions yet</td></tr>
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
                        {hmrcStatusBadge(s.hmrc_status || 'not_submitted')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          <button onClick={() => handleBuildClaim(s.id)} disabled={buildingId === s.id}
                            className="text-xs text-brand-accent hover:text-brand-primary font-medium disabled:opacity-40">
                            {buildingId === s.id ? 'Building…' : 'Build HMRC Claim'}
                          </button>
                          {s.hmrc_claim_xml && (
                            <button onClick={() => setViewingXmlFor(s)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                              View XML
                            </button>
                          )}
                          {s.hmrc_status === 'ready_to_send' && (
                            <button onClick={() => handleSendToEts(s.id)} disabled={sendingId === s.id}
                              className="text-xs text-amber-600 hover:text-amber-800 font-semibold disabled:opacity-40">
                              {sendingId === s.id ? 'Sending…' : 'Send to ETS'}
                            </button>
                          )}
                          {(s.hmrc_status === 'sent' || s.hmrc_status === 'polling') && (
                            <button onClick={() => handleCheckStatus(s.id)} disabled={checkingId === s.id}
                              className="text-xs text-amber-600 hover:text-amber-800 font-semibold disabled:opacity-40">
                              {checkingId === s.id ? 'Checking…' : 'Check Status'}
                            </button>
                          )}
                          <button onClick={() => handleDelete(s.id)} disabled={deletingId === s.id} className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40">
                            {deletingId === s.id ? 'Deleting…' : 'Delete'}
                          </button>
                        </div>
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

            {distinctTaxYears.length > 0 && (
              <p className="text-xs text-gray-400 mb-4">
                Valid rows span <span className="font-semibold text-brand-primary">{distinctTaxYears.length} tax year{distinctTaxYears.length !== 1 ? 's' : ''}</span> ({distinctTaxYears.sort().join(', ')}) — {distinctTaxYears.length > 1 ? 'one submission will be created per tax year.' : 'one submission will be created.'}
              </p>
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
        )}

      {/* HMRC claim XML viewer */}
      {viewingXmlFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">HMRC Claim XML</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Submission {viewingXmlFor.tax_year} — {hmrcStatusBadge(viewingXmlFor.hmrc_status || 'not_submitted')}
                </p>
              </div>
              <button onClick={() => setViewingXmlFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6">
              <p className="text-xs text-gray-400 mb-3">
                Select all (Ctrl/Cmd+A) and copy this into a plain text editor, save it with a .xml extension, then upload it through your Local Test Service page to validate it against HMRC's real schema.
              </p>
              <textarea
                readOnly
                value={viewingXmlFor.hmrc_claim_xml || ''}
                className="w-full h-96 font-mono text-xs border border-gray-200 rounded-lg p-3 bg-gray-50"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
              {viewingXmlFor.hmrc_response_message && (
                <p className="text-xs text-amber-600 mt-3">{viewingXmlFor.hmrc_response_message}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
