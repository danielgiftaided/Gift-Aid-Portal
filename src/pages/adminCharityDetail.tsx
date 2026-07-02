import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import { fetchAllRows } from '../utils/fetchAll'

interface Charity { id: string; name: string; contact_email: string; charity_number: string | null; charity_id: string | null; authorised_official_name: string | null; agent_nominee_reference: string | null }
interface Submission { id: string; submission_date: string; status: string; hmrc_reference: string | null; amount_claimed: number; number_of_donations: number; tax_year: string; hmrc_status: string; hmrc_response_message: string | null; hmrc_claim_xml: string | null; hmrc_correlation_id: string | null; adjustment_amount: number | null; adjustment_explanation: string | null }
interface GasdsClaim {
  id: string; submission_id: string; claim_year: number; amount: number
  connected_charities: boolean; community_buildings: boolean
  connected_charity_details: Array<{charityName:string;hmrcRef:string;year:number;amount:number}> | null
  community_building_details: Array<{buildingName:string;address:string;postcode:string;year:number;amount:number}> | null
  collection_dates: string[]; banked_dates: string[]
  building_address: string | null; building_postcode: string | null
  event_type: string | null; number_of_events: number | null; estimated_attendance: number | null
}
interface OtherIncomeEntry {
  id: string; submission_id: string
  payer: string; date: string; gross_amount: number; tax_deducted: number
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

// Confirmed directly by HMRC: <GatewayTimestamp> must be POPULATED for LTS
// submissions specifically (LTS uses it to evaluate donation dates), but
// must be OMITTED for ETS and live submissions. This only ever transforms
// what's displayed for manual LTS testing — it never touches the stored
// claim XML or anything actually sent to ETS.
// For HMRC's recognition submission specifically, the date must be exactly
// 01/05/2015 as specified in the recognition document (v1.7, p4).
function addGatewayTimestampForLts(xml: string, customDate?: string): string {
  if (!xml) return xml
  // If a custom date is provided (DD/MM/YYYY), convert it to ISO format.
  // Otherwise use the current datetime.
  let timestamp: string
  if (customDate && /^\d{2}\/\d{2}\/\d{4}$/.test(customDate.trim())) {
    const [d, m, y] = customDate.trim().split('/')
    timestamp = `${y}-${m}-${d}T00:00:00`
  } else {
    timestamp = new Date().toISOString()
  }
  return xml.replace(
    /<\/MessageDetails>/,
    `<GatewayTimestamp>${timestamp}</GatewayTimestamp>\n</MessageDetails>`
  )
}

// GASDS's "claim_year" is the calendar year a tax year STARTS in (e.g. tax
// year "2025/26" -> 2025), per HMRC's own schema. Deriving this from the
// submission's own tax_year — rather than letting an admin type it in
// separately — removes an entire class of mismatch that would otherwise
// only be caught later, server-side, when building the claim.
function deriveGasdsClaimYear(taxYear: string): number | null {
  const match = taxYear.match(/^(\d{4})\/\d{2}$/)
  return match ? parseInt(match[1], 10) : null
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
  const [searchParams] = useSearchParams()
  const [charity, setCharity] = useState<Charity | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [gasdsClaims, setGasdsClaims] = useState<Record<string, GasdsClaim>>({}) // keyed by submission_id
  // gasdsModalFor: an existing submission, when editing GASDS attached to it.
  // gasdsModalMode 'standalone' with gasdsModalFor null means creating a
  // brand new GASDS-only claim that isn't attached to any existing
  // donor-based submission at all.
  const [gasdsModalMode, setGasdsModalMode] = useState<'attached' | 'standalone' | null>(null)
  const [gasdsModalFor, setGasdsModalFor] = useState<Submission | null>(null)
  const [gasdsStandaloneTaxYear, setGasdsStandaloneTaxYear] = useState('')
  const [gasdsAmountInput, setGasdsAmountInput] = useState('')
  const [gasdsConnectedInput, setGasdsConnectedInput] = useState(false)
  const [gasdsCommunityInput, setGasdsCommunityInput] = useState(false)
  // Connected charity list — populated when connectedCharities is true
  const [gasdsConnectedCharities, setGasdsConnectedCharities] = useState<Array<{charityName:string;hmrcRef:string;year:string;amount:string}>>([])
  const [gasdsCcName, setGasdsCcName] = useState('')
  const [gasdsCcRef, setGasdsCcRef] = useState('')
  const [gasdsCcYear, setGasdsCcYear] = useState('')
  const [gasdsCcAmount, setGasdsCcAmount] = useState('')
  // Community building list — populated when communityBuildings is true
  const [gasdsBuildingList, setGasdsBuildingList] = useState<Array<{buildingName:string;address:string;postcode:string;year:string;amount:string}>>([])
  const [gasdsBldName, setGasdsBldName] = useState('')
  const [gasdsBldAddress, setGasdsBldAddress] = useState('')
  const [gasdsBldPostcode, setGasdsBldPostcode] = useState('')
  const [gasdsBldYear, setGasdsBldYear] = useState('')
  const [gasdsBldAmount, setGasdsBldAmount] = useState('')
  const [gasdsCollectionDates, setGasdsCollectionDates] = useState<string[]>([])
  const [gasdsCollectionDateInput, setGasdsCollectionDateInput] = useState('')
  const [gasdsBankedDates, setGasdsBankedDates] = useState<string[]>([])
  const [gasdsBankedDateInput, setGasdsBankedDateInput] = useState('')
  const [gasdsBuildingAddress, setGasdsBuildingAddress] = useState('')
  const [gasdsBuildingPostcode, setGasdsBuildingPostcode] = useState('')
  const [gasdsEventType, setGasdsEventType] = useState('')
  const [gasdsNumberOfEvents, setGasdsNumberOfEvents] = useState('')
  const [gasdsEstimatedAttendance, setGasdsEstimatedAttendance] = useState('')
  const [savingGasds, setSavingGasds] = useState(false)
  const [gasdsError, setGasdsError] = useState<string | null>(null)
  // Other income — keyed by submission_id, each value is an array since
  // a submission can have multiple other income entries (unlike GASDS which
  // is one row per submission).
  const [otherIncomeMap, setOtherIncomeMap] = useState<Record<string, OtherIncomeEntry[]>>({})
  const [oiModalFor, setOiModalFor] = useState<Submission | null>(null)
  const [oiEntries, setOiEntries] = useState<OtherIncomeEntry[]>([]) // entries being edited in the modal
  const [oiPayerInput, setOiPayerInput] = useState('')
  const [oiDateInput, setOiDateInput] = useState('')
  const [oiGrossInput, setOiGrossInput] = useState('')
  const [oiTaxInput, setOiTaxInput] = useState('')
  const [savingOi, setSavingOi] = useState(false)
  const [oiError, setOiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState<string | null>(null)
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([])
  const [fileName, setFileName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitSuccess, setSubmitSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [buildingId, setBuildingId] = useState<string | null>(null)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [checkingId, setCheckingId] = useState<string | null>(null)
  const [buildResult, setBuildResult] = useState<{ submissionId: string; ok: boolean; message: string; errors?: string[]; warnings?: string[] } | null>(null)
  const [viewingXmlFor, setViewingXmlFor] = useState<Submission | null>(null)
  const [showLtsVersion, setShowLtsVersion] = useState(false)
  const [ltsTimestampInput, setLtsTimestampInput] = useState('01/05/2015')
  const [sendingDataRequest, setSendingDataRequest] = useState(false)
  const [dataRequestResult, setDataRequestResult] = useState<string | null>(null)

  // Repayment adjustment modal
  const [adjModalFor, setAdjModalFor] = useState<Submission | null>(null)
  const [adjAmountInput, setAdjAmountInput] = useState('')
  const [adjExplanationInput, setAdjExplanationInput] = useState('')
  const [savingAdj, setSavingAdj] = useState(false)
  const [adjError, setAdjError] = useState<string | null>(null)

  // Aggregated donation modal
  const [aggModalFor, setAggModalFor] = useState<Submission | null>(null)
  const [aggDescription, setAggDescription] = useState('')
  const [aggDate, setAggDate] = useState('')
  const [aggAmount, setAggAmount] = useState('')
  const [savingAgg, setSavingAgg] = useState(false)
  const [aggError, setAggError] = useState<string | null>(null)
  const [agentRefInput, setAgentRefInput] = useState('')
  const [savingAgentRef, setSavingAgentRef] = useState(false)
  const [agentRefSaved, setAgentRefSaved] = useState(false)
  const [activeTab, setActiveTab] = useState<'submissions' | 'insights' | 'chv1'>(
    searchParams.get('tab') === 'chv1' ? 'chv1' : 'submissions'
  )
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
        supabase.from('submissions').select('id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year, hmrc_status, hmrc_response_message, hmrc_claim_xml, hmrc_correlation_id, adjustment_amount, adjustment_explanation').eq('charity_id', id).order('submission_date', { ascending: false })
      )
      setSubmissions(subData)

      // GASDS claims are entirely separate from donations — fetched
      // independently and keyed by submission_id for quick lookup in the
      // table below. Most submissions won't have one, which is normal.
      if (subData.length > 0) {
        const { data: gasdsData, error: gasdsErr } = await supabase
          .from('gasds_claims')
          .select('id, submission_id, claim_year, amount, connected_charities, connected_charity_details, community_buildings, community_building_details, collection_dates, banked_dates, building_address, building_postcode, event_type, number_of_events, estimated_attendance')
          .in('submission_id', subData.map(s => s.id))
        if (gasdsErr) throw new Error(gasdsErr.message)
        const keyed: Record<string, GasdsClaim> = {}
        for (const row of gasdsData || []) keyed[row.submission_id] = row as GasdsClaim
        setGasdsClaims(keyed)

        // Other income — multiple entries per submission, so grouped into
        // arrays rather than a one-to-one map. Silently skipped if the
        // table doesn't exist yet.
        try {
          const { data: oiData } = await supabase
            .from('other_income')
            .select('id, submission_id, payer, date, gross_amount, tax_deducted')
            .in('submission_id', subData.map(s => s.id))
          const oiKeyed: Record<string, OtherIncomeEntry[]> = {}
          for (const row of oiData || []) {
            if (!oiKeyed[row.submission_id]) oiKeyed[row.submission_id] = []
            oiKeyed[row.submission_id].push(row as OtherIncomeEntry)
          }
          setOtherIncomeMap(oiKeyed)
        } catch { setOtherIncomeMap({}) }
      } else {
        setGasdsClaims({})
        setOtherIncomeMap({})
      }
    } catch (e: any) { setPageError(e.message) } finally { setLoading(false) }
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

  const resetGasdsModalFields = () => {
    setGasdsAmountInput('')
    setGasdsConnectedInput(false)
    setGasdsCommunityInput(false)
    setGasdsConnectedCharities([])
    setGasdsCcName(''); setGasdsCcRef(''); setGasdsCcYear(''); setGasdsCcAmount('')
    setGasdsBuildingList([])
    setGasdsBldName(''); setGasdsBldAddress(''); setGasdsBldPostcode(''); setGasdsBldYear(''); setGasdsBldAmount('')
    setGasdsCollectionDates([])
    setGasdsCollectionDateInput('')
    setGasdsBankedDates([])
    setGasdsBankedDateInput('')
    setGasdsBuildingAddress('')
    setGasdsBuildingPostcode('')
    setGasdsEventType('')
    setGasdsNumberOfEvents('')
    setGasdsEstimatedAttendance('')
    setGasdsError(null)
  }

  // Editing GASDS attached to an EXISTING submission (whether that
  // submission also has real donor declarations, or was itself originally
  // created as a standalone GASDS-only claim — both end up here, since
  // both already have a real submission_id by this point).
  const openGasdsModal = (submission: Submission) => {
    const existing = gasdsClaims[submission.id]
    resetGasdsModalFields()
    setGasdsModalMode('attached')
    setGasdsModalFor(submission)
    if (existing) {
      setGasdsAmountInput(String(existing.amount))
      setGasdsConnectedInput(existing.connected_charities)
      setGasdsCommunityInput(existing.community_buildings)
      setGasdsCollectionDates(existing.collection_dates || [])
      setGasdsBankedDates(existing.banked_dates || [])
      setGasdsBuildingAddress(existing.building_address || '')
      setGasdsBuildingPostcode(existing.building_postcode || '')
      setGasdsEventType(existing.event_type || '')
      setGasdsNumberOfEvents(existing.number_of_events != null ? String(existing.number_of_events) : '')
      setGasdsEstimatedAttendance(existing.estimated_attendance != null ? String(existing.estimated_attendance) : '')
      // Restore connected charity and building lists from the stored JSONB
      if (existing.connected_charity_details) {
        setGasdsConnectedCharities(existing.connected_charity_details.map(c => ({
          charityName: c.charityName, hmrcRef: c.hmrcRef,
          year: String(c.year), amount: String(c.amount)
        })))
      }
      if (existing.community_building_details) {
        setGasdsBuildingList(existing.community_building_details.map(b => ({
          buildingName: b.buildingName, address: b.address,
          postcode: b.postcode, year: String(b.year), amount: String(b.amount)
        })))
      }
    }
  }

  // Creating a brand new GASDS claim with NO existing donor-based
  // submission at all — e.g. a charity that only ever runs bucket
  // collections for a given tax year. A new lightweight submission (zero
  // donations) is created behind the scenes on save, so this still flows
  // through the exact same build/send/poll pipeline as everything else.
  const openStandaloneGasdsModal = () => {
    resetGasdsModalFields()
    setGasdsModalMode('standalone')
    setGasdsModalFor(null)
    setGasdsStandaloneTaxYear(getTaxYearForDate(new Date()))
  }

  const closeGasdsModal = () => {
    setGasdsModalMode(null)
    setGasdsModalFor(null)
  }

  const addGasdsDate = (kind: 'collection' | 'banked') => {
    const value = kind === 'collection' ? gasdsCollectionDateInput : gasdsBankedDateInput
    if (!value) return
    if (kind === 'collection') {
      setGasdsCollectionDates(prev => [...prev, value].sort())
      setGasdsCollectionDateInput('')
    } else {
      setGasdsBankedDates(prev => [...prev, value].sort())
      setGasdsBankedDateInput('')
    }
  }

  const removeGasdsDate = (kind: 'collection' | 'banked', index: number) => {
    if (kind === 'collection') setGasdsCollectionDates(prev => prev.filter((_, i) => i !== index))
    else setGasdsBankedDates(prev => prev.filter((_, i) => i !== index))
  }

  const handleSaveGasds = async () => {
    const amount = parseFloat(gasdsAmountInput)
    if (isNaN(amount) || amount <= 0) {
      setGasdsError('Enter a valid amount greater than zero.')
      return
    }
    if (gasdsCommunityInput && (!gasdsBuildingAddress.trim() || !gasdsBuildingPostcode.trim())) {
      setGasdsError('Building address and postcode are required when this claim relates to a community building.')
      return
    }

    let claimYear: number | null = null
    if (gasdsModalMode === 'standalone') {
      if (!/^\d{4}\/\d{2}$/.test(gasdsStandaloneTaxYear.trim())) {
        setGasdsError('Enter a valid tax year in the format YYYY/YY, e.g. 2025/26.')
        return
      }
      claimYear = deriveGasdsClaimYear(gasdsStandaloneTaxYear.trim())
    } else if (gasdsModalFor) {
      claimYear = deriveGasdsClaimYear(gasdsModalFor.tax_year)
    }
    if (claimYear === null) {
      setGasdsError('Could not determine a GASDS claim year from the tax year provided.')
      return
    }

    setSavingGasds(true)
    setGasdsError(null)

    const gasdsFields = {
      claim_year: claimYear,
      amount,
      connected_charities: gasdsConnectedInput,
      connected_charity_details: gasdsConnectedInput ? gasdsConnectedCharities.map(c => ({
        charityName: c.charityName, hmrcRef: c.hmrcRef,
        year: parseInt(c.year, 10), amount: parseFloat(c.amount)
      })) : [],
      community_buildings: gasdsCommunityInput,
      community_building_details: gasdsCommunityInput ? gasdsBuildingList.map(b => ({
        buildingName: b.buildingName, address: b.address, postcode: b.postcode,
        year: parseInt(b.year, 10), amount: parseFloat(b.amount)
      })) : [],
      collection_dates: gasdsCollectionDates,
      banked_dates: gasdsBankedDates,
      building_address: gasdsCommunityInput ? (gasdsBuildingAddress.trim() || null) : null,
      building_postcode: gasdsCommunityInput ? (gasdsBuildingPostcode.trim() || null) : null,
      event_type: gasdsCommunityInput ? (gasdsEventType.trim() || null) : null,
      number_of_events: gasdsCommunityInput && gasdsNumberOfEvents ? parseInt(gasdsNumberOfEvents, 10) : null,
      estimated_attendance: gasdsCommunityInput && gasdsEstimatedAttendance ? parseInt(gasdsEstimatedAttendance, 10) : null,
    }

    if (gasdsModalMode === 'standalone') {
      // Create the lightweight carrier submission first, then attach the
      // GASDS claim to it — see comment on openStandaloneGasdsModal above.
      const { data: newSub, error: subErr } = await supabase.from('submissions').insert({
        charity_id: id,
        submission_date: new Date().toISOString().split('T')[0],
        tax_year: gasdsStandaloneTaxYear.trim(),
        amount_claimed: Math.round(amount * 0.25 * 100) / 100,
        number_of_donations: 0,
        status: 'pending',
      }).select('id').single()

      if (subErr || !newSub) {
        setGasdsError(subErr?.message || 'Failed to create a submission for this GASDS claim.')
        setSavingGasds(false)
        return
      }

      const { error: gasdsErr } = await supabase.from('gasds_claims').insert({ submission_id: newSub.id, ...gasdsFields })
      if (gasdsErr) {
        setGasdsError(gasdsErr.message)
        setSavingGasds(false)
        return
      }
    } else {
      if (!gasdsModalFor) { setSavingGasds(false); return }
      const { error } = await supabase.from('gasds_claims').upsert(
        { submission_id: gasdsModalFor.id, ...gasdsFields },
        { onConflict: 'submission_id' }
      )
      if (error) {
        setGasdsError(error.message)
        setSavingGasds(false)
        return
      }
    }

    closeGasdsModal()
    await loadData()
    setSavingGasds(false)
  }

  const handleDeleteGasds = async () => {
    if (!gasdsModalFor) return
    // If this submission only ever existed to carry a GASDS claim (zero
    // real donations), remove the whole submission rather than leaving an
    // empty, donation-less row behind — the GASDS row goes with it
    // automatically (ON DELETE CASCADE). Otherwise, only the GASDS data
    // is removed and the submission (with its real donations) stays.
    const gasdsOnly = gasdsModalFor.number_of_donations === 0
    const confirmMsg = gasdsOnly
      ? 'This GASDS claim has no other donations attached to its submission — removing it will delete the submission entirely. Continue?'
      : 'Remove the GASDS claim from this submission? The submission and its donations will be kept.'
    if (!window.confirm(confirmMsg)) return
    setSavingGasds(true)
    const { error } = gasdsOnly
      ? await supabase.from('submissions').delete().eq('id', gasdsModalFor.id)
      : await supabase.from('gasds_claims').delete().eq('submission_id', gasdsModalFor.id)
    if (error) {
      setGasdsError(error.message)
    } else {
      closeGasdsModal()
      await loadData()
    }
    setSavingGasds(false)
  }

  const openOiModal = (submission: Submission) => {
    setOiModalFor(submission)
    setOiEntries(otherIncomeMap[submission.id] || [])
    setOiPayerInput('')
    setOiDateInput('')
    setOiGrossInput('')
    setOiTaxInput('')
    setOiError(null)
  }

  const closeOiModal = () => { setOiModalFor(null) }

  const handleAddOiEntry = async () => {
    if (!oiModalFor) return
    const payer = oiPayerInput.trim()
    const gross = parseFloat(oiGrossInput)
    const tax = parseFloat(oiTaxInput)
    if (!payer) { setOiError('Payer name is required.'); return }
    if (payer.length > 40) { setOiError('Payer name must be 40 characters or fewer.'); return }
    if (!oiDateInput) { setOiError('Date is required.'); return }
    if (isNaN(gross) || gross < 0.01) { setOiError('Enter a valid gross amount of at least £0.01.'); return }
    if (isNaN(tax) || tax < 0.01) { setOiError('Enter a valid tax deducted amount of at least £0.01.'); return }
    setSavingOi(true); setOiError(null)
    const { data, error } = await supabase.from('other_income').insert({
      submission_id: oiModalFor.id,
      payer,
      date: oiDateInput,
      gross_amount: Math.round(gross * 100) / 100,
      tax_deducted: Math.round(tax * 100) / 100,
    }).select('id, submission_id, payer, date, gross_amount, tax_deducted').single()
    if (error) {
      setOiError(error.message)
    } else {
      setOiEntries(prev => [...prev, data as OtherIncomeEntry])
      setOiPayerInput(''); setOiDateInput(''); setOiGrossInput(''); setOiTaxInput('')
      await loadData()
    }
    setSavingOi(false)
  }

  const handleDeleteOiEntry = async (entryId: string) => {
    if (!window.confirm('Remove this other income entry?')) return
    const { error } = await supabase.from('other_income').delete().eq('id', entryId)
    if (error) { setOiError(error.message); return }
    setOiEntries(prev => prev.filter(e => e.id !== entryId))
    await loadData()
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

  const handleSendDataRequest = async (submissionId: string) => {
    setSendingDataRequest(true)
    setDataRequestResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const resp = await fetch('/api/admin/sendDataRequest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ submission_id: submissionId }),
      })
      const json = await resp.json()
      setDataRequestResult(json.ok ? json.message : `Error: ${json.error}`)
    } catch (e: any) {
      setDataRequestResult(`Error: ${e.message}`)
    } finally {
      setSendingDataRequest(false)
    }
  }

  const openAdjModal = (submission: Submission) => {
    setAdjModalFor(submission)
    setAdjAmountInput(submission.adjustment_amount != null ? String(submission.adjustment_amount) : '')
    setAdjExplanationInput(submission.adjustment_explanation || '')
    setAdjError(null)
  }

  const handleSaveAdjustment = async () => {
    if (!adjModalFor) return
    const amount = parseFloat(adjAmountInput)
    if (adjAmountInput.trim() && isNaN(amount)) {
      setAdjError('Enter a valid number, or leave blank to remove the adjustment.')
      return
    }
    setSavingAdj(true); setAdjError(null)
    const { error } = await supabase
      .from('submissions')
      .update({
        adjustment_amount: adjAmountInput.trim() ? amount : null,
        adjustment_explanation: adjExplanationInput.trim() || null,
      })
      .eq('id', adjModalFor.id)
    if (error) {
      setAdjError(error.message)
    } else {
      setAdjModalFor(null)
      await loadData()
    }
    setSavingAdj(false)
  }

  const openAggModal = (submission: Submission) => {
    setAggModalFor(submission)
    setAggDescription(''); setAggDate(''); setAggAmount(''); setAggError(null)
  }

  const handleSaveAggregated = async () => {
    if (!aggModalFor) return
    const desc = aggDescription.trim()
    const amount = parseFloat(aggAmount)
    if (!desc) { setAggError('Description is required — e.g. "200 x £5 payments from members".'); return }
    if (desc.length > 35) { setAggError('Description must be 35 characters or fewer (HMRC schema limit).'); return }
    if (!aggDate) { setAggError('Donation date is required.'); return }
    if (isNaN(amount) || amount <= 0) { setAggError('Enter a valid amount greater than zero.'); return }
    setSavingAgg(true); setAggError(null)
    const { error } = await supabase.from('donations').insert({
      submission_id: aggModalFor.id,
      charity_id: id,
      aggregated: true,
      aggregated_description: desc,
      donation_date: aggDate,
      amount,
      // Name/address not required for aggregated entries — left null
      first_name: null, last_name: null, address: null, postcode: null, title: null,
    })
    if (error) {
      setAggError(error.message)
    } else {
      setAggModalFor(null)
      await loadData()
    }
    setSavingAgg(false)
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
          <div className="w-full px-8 py-4 flex justify-between items-center">
            <Logo />
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <button onClick={() => navigate('/admin')} className="text-sm font-medium text-brand-accent hover:underline mb-4 inline-block">← Back to Admin</button>
          <h1 className="text-3xl font-bold text-brand-primary">{charity?.name}</h1>

          {/* Tabs */}
          <div className="flex gap-6 mt-6 border-b border-gray-100">
            {[
              { key: 'submissions' as const, label: 'Submissions' },
              { key: 'insights' as const, label: 'Insights' },
              { key: 'chv1' as const, label: 'Charity Information' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => tab.key === 'insights' ? navigate(`/admin/charities/${id}/insights`) : setActiveTab(tab.key)}
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
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-brand-primary">Submissions</h2>
              <button onClick={openStandaloneGasdsModal} className="text-xs font-semibold text-brand-accent hover:text-brand-primary">
                + New GASDS Claim
              </button>
            </div>
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
                      <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap" onClick={e => gasdsClaims[s.id] && e.stopPropagation()}>
                        {s.tax_year}
                        {gasdsClaims[s.id] && (
                          <button
                            onClick={() => openGasdsModal(s)}
                            title="View or edit this submission's GASDS claim"
                            className="ml-1.5 text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 px-1.5 py-0.5 rounded"
                          >
                            GASDS: £{gasdsClaims[s.id].amount.toLocaleString('en-GB', { minimumFractionDigits: 2 })}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-bold text-brand-accent whitespace-nowrap">£{parseFloat(String(s.amount_claimed || 0)).toLocaleString('en-GB', { minimumFractionDigits: 2 })}</td>
                      <td className="px-4 py-3 text-sm text-gray-500">{s.number_of_donations}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-xs font-semibold rounded px-2 py-1 ${statusColor(s.status)}`}>
                          {s.status.charAt(0).toUpperCase() + s.status.slice(1)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-400 font-mono whitespace-nowrap">{s.hmrc_reference || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        {hmrcStatusBadge(s.hmrc_status || 'not_submitted')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => handleBuildClaim(s.id)}
                            disabled={buildingId === s.id}
                            className="text-xs text-brand-accent hover:text-brand-primary font-medium disabled:opacity-40">
                            {buildingId === s.id ? 'Building…' : 'Build HMRC Claim'}
                          </button>
                          {s.hmrc_claim_xml && (
                            <button onClick={() => setViewingXmlFor(s)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                              View XML
                            </button>
                          )}
                          <button onClick={() => openOiModal(s)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                            {(otherIncomeMap[s.id]?.length || 0) > 0
                              ? `Other Income (${otherIncomeMap[s.id].length})`
                              : '+ Other Income'}
                          </button>
                          <button onClick={() => openAdjModal(s)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                            {s.adjustment_amount != null ? `Adj: £${Number(s.adjustment_amount).toFixed(2)}` : '+ Adjustment'}
                          </button>
                          <button onClick={() => openAggModal(s)} className="text-xs text-gray-500 hover:text-gray-700 font-medium">
                            + Aggregated
                          </button>
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
              <div className="flex items-center gap-2 mb-3">
                <button
                  onClick={() => setShowLtsVersion(false)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${!showLtsVersion ? 'bg-brand-accent text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  As sent to ETS
                </button>
                <button
                  onClick={() => setShowLtsVersion(true)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${showLtsVersion ? 'bg-brand-accent text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  For LTS / Recognition
                </button>
              </div>
              {showLtsVersion ? (
                <div className="mb-3 space-y-2">
                  <p className="text-xs text-amber-600">
                    LTS specifically requires a populated &lt;GatewayTimestamp&gt; — ETS and live submissions require it omitted. For HMRC's recognition submission, the timestamp must be exactly <strong>01/05/2015</strong> as specified in the recognition document (v1.7).
                  </p>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">GatewayTimestamp date</label>
                    <input
                      type="text"
                      value={ltsTimestampInput}
                      onChange={e => setLtsTimestampInput(e.target.value)}
                      placeholder="DD/MM/YYYY"
                      className="text-xs border border-gray-200 rounded px-2 py-1 w-32 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                    />
                    <span className="text-xs text-gray-300">Use 01/05/2015 for HMRC recognition</span>
                  </div>
                </div>
              ) : (
                <div className="mb-3 space-y-2">
                  <p className="text-xs text-gray-400">
                    This is the exact XML sent (or ready to send) to HMRC's External Test Service. Switch to "For LTS / Recognition" to add a GatewayTimestamp for LTS validation or the HMRC recognition submission.
                  </p>
                  {viewingXmlFor.hmrc_correlation_id && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handleSendDataRequest(viewingXmlFor.id)}
                        disabled={sendingDataRequest}
                        className="text-xs font-semibold text-brand-accent hover:text-brand-primary disabled:opacity-40"
                      >
                        {sendingDataRequest ? 'Sending…' : 'Send DATA_REQUEST (for HMRC recognition)'}
                      </button>
                      {dataRequestResult && (
                        <span className="text-xs text-gray-500">{dataRequestResult}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
              <textarea
                readOnly
                value={showLtsVersion
                  ? addGatewayTimestampForLts(viewingXmlFor.hmrc_claim_xml || '', ltsTimestampInput)
                  : (viewingXmlFor.hmrc_claim_xml || '')}
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

      {/* GASDS entry modal — lump-sum small donations claim, structurally
          unlike everything else in this portal: no individual donor
          records at all. Can either be created standalone (its own
          lightweight submission, created on save) or attached to an
          existing submission's donor-by-donor donations. */}
      {gasdsModalMode && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full my-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">GASDS Claim</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  {gasdsModalMode === 'standalone' ? 'New standalone claim — no donor-based submission required' : `Tax year ${gasdsModalFor?.tax_year}`}
                </p>
              </div>
              <button onClick={closeGasdsModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
              <p className="text-xs text-gray-400">
                Gift Aid Small Donations Scheme — a lump-sum claim on small cash collections (e.g. bucket collections) with no individual donor declarations. Only the amount and the two yes/no questions below are ever sent to HMRC; everything else here is record-keeping evidence kept on file in case of a compliance check.
              </p>

              {gasdsModalMode === 'standalone' && (
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Tax year</label>
                  <input
                    type="text"
                    value={gasdsStandaloneTaxYear}
                    onChange={e => setGasdsStandaloneTaxYear(e.target.value)}
                    placeholder="e.g. 2025/26"
                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Total amount collected (£)</label>
                <input
                  type="number" min="0" step="0.01"
                  value={gasdsAmountInput}
                  onChange={e => setGasdsAmountInput(e.target.value)}
                  placeholder="e.g. 450.00"
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                />
              </div>

              <label className="flex items-start gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={gasdsConnectedInput} onChange={e => setGasdsConnectedInput(e.target.checked)} className="mt-0.5" />
                <span>This charity is part of a group of connected charities sharing the small-donations allowance</span>
              </label>

              {/* Connected charity detail — one row per connected charity */}
              {gasdsConnectedInput && (
                <div className="bg-brand-surface/60 border border-gray-100 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-brand-primary uppercase tracking-wide">Connected charities</p>
                  {gasdsConnectedCharities.length > 0 && (
                    <div className="space-y-1">
                      {gasdsConnectedCharities.map((c, i) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 text-xs text-gray-600">
                          <span>{c.charityName} · {c.hmrcRef} · {c.year} · £{parseFloat(c.amount).toFixed(2)}</span>
                          <button type="button" onClick={() => setGasdsConnectedCharities(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 ml-3">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={gasdsCcName} onChange={e => setGasdsCcName(e.target.value)} placeholder="Charity name" className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="text" value={gasdsCcRef} onChange={e => setGasdsCcRef(e.target.value)} placeholder="HMRC Ref (e.g. AB98765)" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="number" value={gasdsCcYear} onChange={e => setGasdsCcYear(e.target.value)} placeholder="Year (e.g. 2014)" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="number" value={gasdsCcAmount} onChange={e => setGasdsCcAmount(e.target.value)} placeholder="Amount (£)" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <button type="button" onClick={() => {
                      if (!gasdsCcName || !gasdsCcRef || !gasdsCcYear || !gasdsCcAmount) return
                      setGasdsConnectedCharities(prev => [...prev, { charityName: gasdsCcName, hmrcRef: gasdsCcRef, year: gasdsCcYear, amount: gasdsCcAmount }])
                      setGasdsCcName(''); setGasdsCcRef(''); setGasdsCcYear(''); setGasdsCcAmount('')
                    }} className="text-xs font-semibold text-brand-accent border border-brand-accent/30 rounded px-2 py-1 hover:bg-brand-accent/5">
                      Add charity
                    </button>
                  </div>
                </div>
              )}

              <label className="flex items-start gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={gasdsCommunityInput} onChange={e => setGasdsCommunityInput(e.target.checked)} className="mt-0.5" />
                <span>Some or all of this claim relates to donations collected in a community building (e.g. a village hall)</span>
              </label>

              {/* Community building detail — one row per building */}
              {gasdsCommunityInput && (
                <div className="bg-brand-surface/60 border border-gray-100 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-brand-primary uppercase tracking-wide">Community buildings</p>
                  {gasdsBuildingList.length > 0 && (
                    <div className="space-y-1">
                      {gasdsBuildingList.map((b, i) => (
                        <div key={i} className="flex items-center justify-between bg-white rounded px-3 py-1.5 text-xs text-gray-600">
                          <span>{b.buildingName} · {b.address} · {b.postcode} · {b.year} · £{parseFloat(b.amount).toFixed(2)}</span>
                          <button type="button" onClick={() => setGasdsBuildingList(prev => prev.filter((_, idx) => idx !== i))} className="text-red-400 hover:text-red-600 ml-3">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input type="text" value={gasdsBldName} onChange={e => setGasdsBldName(e.target.value)} placeholder="Building name" className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="text" value={gasdsBldAddress} onChange={e => setGasdsBldAddress(e.target.value)} placeholder="Address" className="col-span-2 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="text" value={gasdsBldPostcode} onChange={e => setGasdsBldPostcode(e.target.value)} placeholder="Postcode" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="number" value={gasdsBldYear} onChange={e => setGasdsBldYear(e.target.value)} placeholder="Year (e.g. 2014)" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <input type="number" value={gasdsBldAmount} onChange={e => setGasdsBldAmount(e.target.value)} placeholder="Amount (£)" className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    <button type="button" onClick={() => {
                      if (!gasdsBldName || !gasdsBldAddress || !gasdsBldPostcode || !gasdsBldYear || !gasdsBldAmount) return
                      setGasdsBuildingList(prev => [...prev, { buildingName: gasdsBldName, address: gasdsBldAddress, postcode: gasdsBldPostcode, year: gasdsBldYear, amount: gasdsBldAmount }])
                      setGasdsBldName(''); setGasdsBldAddress(''); setGasdsBldPostcode(''); setGasdsBldYear(''); setGasdsBldAmount('')
                    }} className="text-xs font-semibold text-brand-accent border border-brand-accent/30 rounded px-2 py-1 hover:bg-brand-accent/5">
                      Add building
                    </button>
                  </div>
                </div>
              )}

              {/* Record-keeping: collection dates */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Dates the collections took place</label>
                <div className="flex gap-2">
                  <input type="date" value={gasdsCollectionDateInput} onChange={e => setGasdsCollectionDateInput(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                  <button type="button" onClick={() => addGasdsDate('collection')} className="px-3 py-1.5 text-xs font-semibold text-brand-accent border border-brand-accent/30 rounded hover:bg-brand-accent/5">Add</button>
                </div>
                {gasdsCollectionDates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {gasdsCollectionDates.map((d, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        {new Date(d).toLocaleDateString('en-GB')}
                        <button type="button" onClick={() => removeGasdsDate('collection', i)} className="text-gray-400 hover:text-red-500 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Record-keeping: banked dates */}
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Dates the cash was paid into the charity's UK bank account</label>
                <div className="flex gap-2">
                  <input type="date" value={gasdsBankedDateInput} onChange={e => setGasdsBankedDateInput(e.target.value)}
                    className="flex-1 text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                  <button type="button" onClick={() => addGasdsDate('banked')} className="px-3 py-1.5 text-xs font-semibold text-brand-accent border border-brand-accent/30 rounded hover:bg-brand-accent/5">Add</button>
                </div>
                {gasdsBankedDates.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {gasdsBankedDates.map((d, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                        {new Date(d).toLocaleDateString('en-GB')}
                        <button type="button" onClick={() => removeGasdsDate('banked', i)} className="text-gray-400 hover:text-red-500 leading-none">×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Community building detail — only relevant when that checkbox is ticked */}
              {gasdsCommunityInput && (
                <div className="bg-brand-surface/60 border border-gray-100 rounded-lg p-4 space-y-3">
                  <p className="text-xs font-semibold text-brand-primary uppercase tracking-wide">Community building detail</p>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Building address</label>
                    <input type="text" value={gasdsBuildingAddress} onChange={e => setGasdsBuildingAddress(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Postcode</label>
                    <input type="text" value={gasdsBuildingPostcode} onChange={e => setGasdsBuildingPostcode(e.target.value)}
                      className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Type of event</label>
                    <input type="text" value={gasdsEventType} onChange={e => setGasdsEventType(e.target.value)}
                      placeholder="e.g. Coffee morning, Carol service"
                      className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Number of events</label>
                      <input type="number" min="1" value={gasdsNumberOfEvents} onChange={e => setGasdsNumberOfEvents(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Estimated attendance</label>
                      <input type="number" min="0" value={gasdsEstimatedAttendance} onChange={e => setGasdsEstimatedAttendance(e.target.value)}
                        className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
                    </div>
                  </div>
                </div>
              )}

              {gasdsError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{gasdsError}</div>}

              <div className="flex items-center justify-between pt-2">
                {gasdsModalMode === 'attached' && gasdsModalFor && gasdsClaims[gasdsModalFor.id] ? (
                  <button onClick={handleDeleteGasds} disabled={savingGasds} className="text-xs text-red-500 hover:text-red-700 font-medium disabled:opacity-40">
                    Remove GASDS claim
                  </button>
                ) : <span />}
                <button onClick={handleSaveGasds} disabled={savingGasds} className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  {savingGasds ? 'Saving…' : 'Save GASDS Claim'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Other Income entry modal — covenanted payments or other income
          where tax has already been deducted at source. Maps to the
          <OtherInc> elements inside <Repayment> in the R68 XML.
          Multiple entries per submission are fully supported. */}
      {oiModalFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50 overflow-y-auto py-8">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full my-auto">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">Other Income</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Tax year {oiModalFor.tax_year} — other income received under Gift Aid where tax has already been deducted at source (e.g. covenanted payments)
                </p>
              </div>
              <button onClick={closeOiModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

              {/* Existing entries */}
              {oiEntries.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Entries on this submission</p>
                  <div className="space-y-2">
                    {oiEntries.map(e => (
                      <div key={e.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                        <div className="text-sm">
                          <span className="font-medium text-brand-primary">{e.payer}</span>
                          <span className="text-gray-400 mx-2">·</span>
                          <span className="text-gray-500">{e.date}</span>
                          <span className="text-gray-400 mx-2">·</span>
                          <span className="text-gray-600">Gross: £{Number(e.gross_amount).toFixed(2)}</span>
                          <span className="text-gray-400 mx-2">·</span>
                          <span className="text-gray-600">Tax: £{Number(e.tax_deducted).toFixed(2)}</span>
                        </div>
                        <button
                          onClick={() => handleDeleteOiEntry(e.id)}
                          className="text-xs text-red-400 hover:text-red-600 font-medium ml-3 flex-shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Add a new entry */}
              <div className="border-t border-gray-100 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Add an entry</p>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Payer name (max 40 characters)</label>
                  <input
                    type="text" maxLength={40}
                    value={oiPayerInput}
                    onChange={e => setOiPayerInput(e.target.value)}
                    placeholder="e.g. Lloyds TSB"
                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Date received (DD/MM/YYYY)</label>
                  <input
                    type="text"
                    value={oiDateInput}
                    onChange={e => setOiDateInput(e.target.value)}
                    placeholder="e.g. 05/04/2015"
                    className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Gross amount (£)</label>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={oiGrossInput}
                      onChange={e => setOiGrossInput(e.target.value)}
                      placeholder="e.g. 1000.00"
                      className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Tax deducted (£)</label>
                    <input
                      type="number" min="0.01" step="0.01"
                      value={oiTaxInput}
                      onChange={e => setOiTaxInput(e.target.value)}
                      placeholder="e.g. 250.00"
                      className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                    />
                  </div>
                </div>

                {oiError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{oiError}</div>}

                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleAddOiEntry}
                    disabled={savingOi}
                    className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
                  >
                    {savingOi ? 'Saving…' : 'Add Entry'}
                  </button>
                </div>
              </div>

              {oiEntries.length === 0 && (
                <p className="text-xs text-gray-300 text-center py-2">No other income entries yet — add one above.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Repayment adjustment modal — sets <Adjustment> inside <Repayment>
          in the R68 XML, and optionally <OtherInfo> at the Claim level. */}
      {adjModalFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">Repayment Adjustment</h3>
                <p className="text-xs text-gray-400 mt-0.5">Tax year {adjModalFor.tax_year} — adjusts the total repayment claim. Separate from the GASDS adjustment.</p>
              </div>
              <button onClick={() => setAdjModalFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Adjustment amount (£)</label>
                <input
                  type="number" step="0.01"
                  value={adjAmountInput}
                  onChange={e => setAdjAmountInput(e.target.value)}
                  placeholder="e.g. 50.00"
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                />
                <p className="text-xs text-gray-300 mt-1">Leave blank to remove an existing adjustment. Positive = HMRC owes more; negative = correcting an overclaim.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Explanation (optional, max 350 chars)</label>
                <textarea
                  value={adjExplanationInput}
                  onChange={e => setAdjExplanationInput(e.target.value)}
                  maxLength={350}
                  rows={3}
                  placeholder="e.g. Correcting an error on a previous submission"
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30 resize-none"
                />
              </div>
              {adjError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{adjError}</div>}
              <div className="flex justify-end">
                <button onClick={handleSaveAdjustment} disabled={savingAdj} className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  {savingAdj ? 'Saving…' : 'Save Adjustment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aggregated donation modal — creates a row in the donations table
          with aggregated=true, which maps to <AggDonation> in the R68 XML
          instead of a named <Donor>. No name or address is required. */}
      {aggModalFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-brand-primary">Aggregated Donation</h3>
                <p className="text-xs text-gray-400 mt-0.5">Tax year {aggModalFor.tax_year} — a lump sum covering multiple small donations where individual names are not collected. Maps to &lt;AggDonation&gt; in the R68 XML.</p>
              </div>
              <button onClick={() => setAggModalFor(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Description (max 35 characters)</label>
                <input
                  type="text" maxLength={35}
                  value={aggDescription}
                  onChange={e => setAggDescription(e.target.value)}
                  placeholder='e.g. 200 x £5 payments from members'
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                />
                <p className="text-xs text-gray-300 mt-1">{aggDescription.length}/35 characters</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Date (DD/MM/YYYY)</label>
                <input
                  type="text"
                  value={aggDate}
                  onChange={e => setAggDate(e.target.value)}
                  placeholder="e.g. 05/04/2015"
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Total amount (£)</label>
                <input
                  type="number" min="0.01" step="0.01"
                  value={aggAmount}
                  onChange={e => setAggAmount(e.target.value)}
                  placeholder="e.g. 1000.00"
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30"
                />
              </div>
              {aggError && <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-xs">{aggError}</div>}
              <div className="flex justify-end">
                <button onClick={handleSaveAggregated} disabled={savingAgg} className="bg-brand-accent text-white rounded-lg px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40">
                  {savingAgg ? 'Saving…' : 'Add Aggregated Donation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  )
}
