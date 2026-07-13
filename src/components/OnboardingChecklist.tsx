import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

interface Checklist {
  id: string
  dpa_status: string; proposal_status: string; commercial_terms_status: string
  hmrc_ref_status: string; charity_commission_status: string
  chv1_status: string; hmrc_nominee_confirmed: boolean
  payment_logins_status: string; past_claims_status: string; gasds_details_status: string
  claim_built: boolean; submitted_to_hmrc: boolean
  payment_received: boolean; charity_paid: boolean
  reporting_setup: boolean; last_contact_date: string | null
  updated_at: string
}

interface Props {
  charityId?: string
  charityEmail?: string
}

// ── Small UI atoms ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h3 className="text-xs font-bold text-brand-primary uppercase tracking-widest">{title}</h3>
      <div className="flex-1 h-px bg-gray-100" />
    </div>
  )
}

function StatusSelect({
  label, value, options, onChange, saving,
}: {
  label: string
  value: string
  options: { value: string; label: string; colour: string }[]
  onChange: (v: string) => void
  saving: boolean
}) {
  const current = options.find(o => o.value === value)
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-600">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={saving}
        className={`text-xs font-semibold border-0 rounded-full px-3 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30 cursor-pointer disabled:opacity-50 ${current?.colour || 'bg-gray-100 text-gray-500'}`}
      >
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function TickRow({
  label, checked, onChange, saving,
}: {
  label: string; checked: boolean; onChange: (v: boolean) => void; saving: boolean
}) {
  return (
    <label className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 cursor-pointer">
      <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border-2 transition-colors ${checked ? 'bg-brand-accent border-brand-accent' : 'border-gray-300'}`}
        onClick={() => !saving && onChange(!checked)}>
        {checked && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>}
      </div>
      <span className="text-sm text-gray-600 select-none">{label}</span>
    </label>
  )
}

// ── Option sets ─────────────────────────────────────────────────────────────

const sentSigned = [
  { value: 'not_sent',  label: 'Not sent', colour: 'bg-gray-100 text-gray-500' },
  { value: 'sent',      label: 'Sent',     colour: 'bg-amber-100 text-amber-700' },
  { value: 'signed',    label: 'Signed',   colour: 'bg-green-100 text-green-700' },
]
const outstandingReceived = [
  { value: 'outstanding', label: 'Outstanding', colour: 'bg-amber-100 text-amber-700' },
  { value: 'received',    label: 'Received',    colour: 'bg-green-100 text-green-700' },
]
const chv1Options = [
  { value: 'not_started', label: 'Not started',  colour: 'bg-gray-100 text-gray-500' },
  { value: 'in_progress', label: 'In progress',  colour: 'bg-blue-100 text-blue-700' },
  { value: 'sent',        label: 'Sent',         colour: 'bg-amber-100 text-amber-700' },
  { value: 'received',    label: 'Received',     colour: 'bg-green-100 text-green-700' },
]
const threeWay = [
  { value: 'outstanding',    label: 'Outstanding',    colour: 'bg-amber-100 text-amber-700' },
  { value: 'received',       label: 'Received',       colour: 'bg-green-100 text-green-700' },
  { value: 'not_applicable', label: 'Not applicable', colour: 'bg-gray-100 text-gray-500' },
]

// ── Progress bar ─────────────────────────────────────────────────────────────

function completionPercent(cl: Checklist): number {
  const items = [
    cl.dpa_status === 'signed', cl.proposal_status === 'signed', cl.commercial_terms_status === 'signed',
    cl.hmrc_ref_status === 'received', cl.charity_commission_status === 'received',
    cl.chv1_status === 'received', cl.hmrc_nominee_confirmed,
    cl.payment_logins_status === 'received',
    cl.past_claims_status !== 'outstanding', cl.gasds_details_status !== 'outstanding',
    cl.claim_built, cl.submitted_to_hmrc, cl.payment_received, cl.charity_paid,
    cl.reporting_setup,
  ]
  const done = items.filter(Boolean).length
  return Math.round((done / items.length) * 100)
}

// ── Main component ───────────────────────────────────────────────────────────

export default function OnboardingChecklist({ charityId, charityEmail }: Props) {
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => { loadChecklist() }, [charityId, charityEmail])

  const loadChecklist = async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const params = new URLSearchParams()
      if (charityId) params.set('charity_id', charityId)
      else if (charityEmail) params.set('email', charityEmail)
      const resp = await fetch(`/api/admin/onboardingChecklist?${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      setChecklist(json.checklist)
    } catch (e: any) { setError(e.message) } finally { setLoading(false) }
  }

  const save = async (field: string, value: any) => {
    if (!checklist) return
    const updated = { ...checklist, [field]: value }
    setChecklist(updated)
    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const email = charityEmail || checklist.charity_email || ''
      const resp = await fetch('/api/admin/onboardingChecklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          charity_email: email,
          charity_id: charityId || null,
          [field]: value,
        }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      setSavedAt(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    } catch (e: any) { setError(e.message) } finally { setSaving(false) }
  }

  if (loading) return <div className="py-10 text-center text-gray-300 text-sm">Loading onboarding checklist…</div>
  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
  if (!checklist) return null

  const pct = completionPercent(checklist)

  return (
    <div className="space-y-6">

      {/* Progress */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-brand-primary">Onboarding progress</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-brand-accent">{pct}%</span>
            {savedAt && <span className="text-xs text-gray-400">Saved at {savedAt}</span>}
            {saving && <span className="text-xs text-gray-400">Saving…</span>}
          </div>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-brand-accent h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Contracts */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Contracts" />
        <StatusSelect label="Data Processing Agreement" value={checklist.dpa_status}
          options={sentSigned} onChange={v => save('dpa_status', v)} saving={saving} />
        <StatusSelect label="Proposal" value={checklist.proposal_status}
          options={sentSigned} onChange={v => save('proposal_status', v)} saving={saving} />
        <StatusSelect label="Commercial Terms (fee structure, payment terms etc)" value={checklist.commercial_terms_status}
          options={sentSigned} onChange={v => save('commercial_terms_status', v)} saving={saving} />
      </div>

      {/* Documentation */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Documentation" />
        <StatusSelect label="HMRC Charities Reference Number" value={checklist.hmrc_ref_status}
          options={outstandingReceived} onChange={v => save('hmrc_ref_status', v)} saving={saving} />
        <StatusSelect label="Charity Commission Registration Number" value={checklist.charity_commission_status}
          options={outstandingReceived} onChange={v => save('charity_commission_status', v)} saving={saving} />
        <StatusSelect label="ChV1 Form" value={checklist.chv1_status}
          options={chv1Options} onChange={v => save('chv1_status', v)} saving={saving} />
        <TickRow label="Confirmation from HMRC of Gift Aided as nominee received"
          checked={checklist.hmrc_nominee_confirmed}
          onChange={v => save('hmrc_nominee_confirmed', v)} saving={saving} />
      </div>

      {/* Analysis */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Analysis" />
        <StatusSelect label="Received payment / donation platform logins" value={checklist.payment_logins_status}
          options={outstandingReceived} onChange={v => save('payment_logins_status', v)} saving={saving} />
        <StatusSelect label="If applicable, receive past claims for comparison" value={checklist.past_claims_status}
          options={threeWay} onChange={v => save('past_claims_status', v)} saving={saving} />
        <StatusSelect label="Received event details for GASDS submission(s)" value={checklist.gasds_details_status}
          options={threeWay} onChange={v => save('gasds_details_status', v)} saving={saving} />
      </div>

      {/* Submissions */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Submissions" />
        <TickRow label="Build claim submissions" checked={checklist.claim_built}
          onChange={v => save('claim_built', v)} saving={saving} />
        <TickRow label="Submit to HMRC" checked={checklist.submitted_to_hmrc}
          onChange={v => save('submitted_to_hmrc', v)} saving={saving} />
        <TickRow label="Payment received from HMRC" checked={checklist.payment_received}
          onChange={v => save('payment_received', v)} saving={saving} />
        <TickRow label="Charity paid" checked={checklist.charity_paid}
          onChange={v => save('charity_paid', v)} saving={saving} />
      </div>

      {/* Ongoing */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <SectionHeader title="Ongoing" />
        <TickRow label="Ensure reporting is set up" checked={checklist.reporting_setup}
          onChange={v => save('reporting_setup', v)} saving={saving} />
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-gray-600">Date of last contact</span>
          <input
            type="date"
            value={checklist.last_contact_date || ''}
            onChange={e => save('last_contact_date', e.target.value || null)}
            disabled={saving}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-accent/30 disabled:opacity-50"
          />
        </div>
      </div>

    </div>
  )
}
