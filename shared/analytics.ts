import { giftAidRecordGroup } from './giftAidRecords'

export interface AnalyticsSubmission {
  id: string
  charity_id?: string
  tax_year: string | null
  submission_date: string | null
  amount_claimed: number | string | null
  number_of_donations: number | null
  status: string
  hmrc_status?: string | null
}
export interface AnalyticsRecord {
  id?: string
  charity_id?: string
  submission_id?: string | null
  tax_year: string | null
  donation_date: string | null
  amount: number | string | null
  record_status: string
  gift_aid_opt_in: string | null
  gift_aid_submitted?: boolean | null
}
export interface AnalyticsCharity {
  id: string
  name: string
}
export interface AnalyticsFilters {
  taxYear: string
  charityId: string
}
export const QUALITY = [
  { key: 'eligible', label: 'Eligible records', color: '#0c806b' },
  {
    key: 'incomplete_opt_in',
    label: 'Incomplete · opted in',
    color: '#e9a23b',
  },
  {
    key: 'incomplete_opt_out',
    label: 'Incomplete · no consent',
    color: '#d87661',
  },
  { key: 'opt_out', label: 'Opted out / no consent', color: '#99a5b7' },
  { key: 'historic', label: 'Historic claims', color: '#5879b5' },
  { key: 'other', label: 'Other records', color: '#a290bd' },
] as const
export const HMRC_STAGES = [
  'not_submitted',
  'validation_failed',
  'ready_to_send',
  'sent',
  'polling',
  'accepted',
  'rejected',
  'error',
  'unknown',
] as const
export const CLAIM_SUMMARY = [
  { key: 'accepted', label: 'Accepted', description: 'Accepted by HMRC', color: '#0c745d' },
  { key: 'awaiting_hmrc', label: 'Awaiting HMRC', description: 'Sent and waiting for a response', color: '#304675' },
  { key: 'needs_attention', label: 'Needs attention', description: 'Unsent claims or issues to check', color: '#a36c23' },
] as const
export function claimSummaryGroup(status?: string | null): typeof CLAIM_SUMMARY[number]['key'] {
  if (status === 'accepted') return 'accepted'
  if (status === 'sent' || status === 'polling') return 'awaiting_hmrc'
  return 'needs_attention'
}
export function hmrcStage(status?: string | null): string {
  return status && (HMRC_STAGES as readonly string[]).includes(status)
    ? status
    : 'unknown'
}
export function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}
const money = (n: number) => Math.round(n * 100) / 100
export function donationDate(raw: string | null): string | null {
  if (!raw) return null
  const iso = raw.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/)
  const uk = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!iso && !uk) return null
  const y = iso
    ? Number(iso[1])
    : Number(uk![3].length === 2 ? `20${uk![3]}` : uk![3])
  const m = Number(iso ? iso[2] : uk![2]),
    d = Number(iso ? iso[3] : uk![1])
  const date = new Date(Date.UTC(y, m - 1, d))
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  )
    return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
export function recordTaxYear(record: AnalyticsRecord): string {
  const date = donationDate(record.donation_date)
  if (!date) return record.tax_year || 'Unknown'
  const [y, m, d] = date.split('-').map(Number)
  const start = m > 4 || (m === 4 && d >= 6) ? y : y - 1
  return `${start}/${String(start + 1).slice(-2)}`
}
export function qualityGroup(record: AnalyticsRecord): string {
  const group = giftAidRecordGroup(record)
  return group === 'valid'
    ? 'eligible'
    : QUALITY.some((item) => item.key === group)
      ? group
      : 'other'
}
export function buildAnalytics(
  submissions: AnalyticsSubmission[],
  records: AnalyticsRecord[],
  charities: AnalyticsCharity[],
  filters: AnalyticsFilters,
) {
  const inCharity = (r: { charity_id?: string }) =>
    filters.charityId === 'all' || r.charity_id === filters.charityId
  const filteredSubmissions = submissions.filter(
    (s) =>
      inCharity(s) &&
      (filters.taxYear === 'all' ||
        (s.tax_year || 'Unknown') === filters.taxYear),
  )
  const filteredRecords = records.filter(
    (r) =>
      inCharity(r) &&
      (filters.taxYear === 'all' || recordTaxYear(r) === filters.taxYear),
  )
  const taxYears = [
    ...new Set([
      ...submissions.map((s) => s.tax_year || 'Unknown'),
      ...records.map(recordTaxYear),
    ]),
  ].sort()
  const quality = QUALITY.map((item) => {
    const rows = filteredRecords.filter((r) => qualityGroup(r) === item.key)
    return {
      ...item,
      count: rows.length,
      donationValue: money(rows.reduce((s, r) => s + numberValue(r.amount), 0)),
    }
  })
  const recoverable = filteredRecords.filter(
    (r) =>
      qualityGroup(r) === 'incomplete_opt_in' && r.gift_aid_submitted !== false,
  )
  const eligible = filteredRecords.filter((r) => qualityGroup(r) === 'eligible')
  const years = [
    ...new Set([
      ...filteredSubmissions.map((s) => s.tax_year || 'Unknown'),
      ...filteredRecords.map(recordTaxYear),
    ]),
  ].sort()
  const byYear = years.map((year) => {
    const ss = filteredSubmissions.filter(
        (s) => (s.tax_year || 'Unknown') === year,
      ),
      rr = filteredRecords.filter((r) => recordTaxYear(r) === year)
    return {
      year,
      recorded: money(
        ss.reduce((sum, s) => sum + numberValue(s.amount_claimed), 0),
      ),
      accepted: money(
        ss
          .filter((s) => s.hmrc_status === 'accepted')
          .reduce((sum, s) => sum + numberValue(s.amount_claimed), 0),
      ),
      donations: money(rr.reduce((sum, r) => sum + numberValue(r.amount), 0)),
      potential: money(
        rr
          .filter((r) => qualityGroup(r) === 'eligible')
          .reduce((sum, r) => sum + Math.max(0, numberValue(r.amount)), 0) *
          0.25,
      ),
      records: rr.length,
      claims: ss.length,
      ...Object.fromEntries(
        QUALITY.map((g) => [
          g.key,
          rr.filter((r) => qualityGroup(r) === g.key).length,
        ]),
      ),
    }
  })
  const monthMap = new Map<
    string,
    { month: string; donations: number; records: number }
  >()
  let undatedRecords = 0
  for (const r of filteredRecords) {
    const date = donationDate(r.donation_date)
    if (!date) {
      undatedRecords++
      continue
    }
    const month = date.slice(0, 7),
      item = monthMap.get(month) || { month, donations: 0, records: 0 }
    item.donations = money(item.donations + numberValue(r.amount))
    item.records++
    monthMap.set(month, item)
  }
  // Fill gaps so a line never hides months with no recorded donations.
  const observed = [...monthMap.keys()].sort()
  if (observed.length) {
    let cursor = observed[0]
    const end = observed[observed.length - 1]
    while (cursor <= end) {
      if (!monthMap.has(cursor))
        monthMap.set(cursor, { month: cursor, donations: 0, records: 0 })
      const [year, month] = cursor.split('-').map(Number)
      cursor = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}`
    }
  }
  const pipeline = HMRC_STAGES.map((key) => {
    const rows = filteredSubmissions.filter(
      (s) => hmrcStage(s.hmrc_status) === key,
    )
    return {
      key,
      name: key.replace(/_/g, ' '),
      count: rows.length,
      value: money(
        rows.reduce((sum, s) => sum + numberValue(s.amount_claimed), 0),
      ),
    }
  })
  const claimSummary = CLAIM_SUMMARY.map((group) => {
    const rows = filteredSubmissions.filter((s) => claimSummaryGroup(s.hmrc_status) === group.key)
    return {
      ...group,
      count: rows.length,
      value: money(rows.reduce((sum, s) => sum + numberValue(s.amount_claimed), 0)),
    }
  })
  const ranking = charities
    .filter((c) => filters.charityId === 'all' || c.id === filters.charityId)
    .map((c) => {
      const ss = filteredSubmissions.filter((s) => s.charity_id === c.id)
      return {
        ...c,
        recorded: money(
          ss.reduce((sum, s) => sum + numberValue(s.amount_claimed), 0),
        ),
        claims: ss.length,
        accepted: ss.filter((s) => s.hmrc_status === 'accepted').length,
      }
    })
    .sort((a, b) => b.recorded - a.recorded || a.name.localeCompare(b.name))
  const bounds = [5, 20, 50, 100, 500, Infinity]
  const distribution = bounds.map((upper, i) => {
    const lower = i ? bounds[i - 1] : 0
    const rows = filteredRecords.filter(
      (r) => numberValue(r.amount) > lower && numberValue(r.amount) <= upper,
    )
    return {
      band:
        i === 0 ? '£0–5' : upper === Infinity ? '£500+' : `£${lower}–${upper}`,
      count: rows.length,
      value: money(rows.reduce((sum, r) => sum + numberValue(r.amount), 0)),
    }
  })
  const recorded = money(
    filteredSubmissions.reduce(
      (sum, s) => sum + numberValue(s.amount_claimed),
      0,
    ),
  )
  const accepted = money(
    filteredSubmissions
      .filter((s) => s.hmrc_status === 'accepted')
      .reduce((sum, s) => sum + numberValue(s.amount_claimed), 0),
  )
  const donationValue = money(
    filteredRecords.reduce((sum, r) => sum + numberValue(r.amount), 0),
  )
  return {
    taxYears,
    submissions: filteredSubmissions,
    records: filteredRecords,
    quality,
    byYear,
    monthly: [...monthMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    ),
    pipeline,
    claimSummary,
    ranking,
    distribution,
    recorded,
    accepted,
    donationValue,
    undatedRecords,
    potential: money(
      eligible.reduce((sum, r) => sum + Math.max(0, numberValue(r.amount)), 0) *
        0.25,
    ),
    recoverable: money(
      recoverable.reduce(
        (sum, r) => sum + Math.max(0, numberValue(r.amount)),
        0,
      ) * 0.25,
    ),
    eligibleCount: eligible.length,
    incompleteCount: recoverable.length,
    readiness: filteredRecords.length
      ? Math.round((eligible.length / filteredRecords.length) * 100)
      : null,
    averageDonation: filteredRecords.length
      ? money(donationValue / filteredRecords.length)
      : null,
    unlinkedClaims: !charities.length
      ? 0
      : filteredSubmissions.filter(
          (s) => s.charity_id && !charities.some((c) => c.id === s.charity_id),
        ).length,
    nonPositiveRecords: filteredRecords.filter(
      (r) => numberValue(r.amount) <= 0,
    ).length,
  }
}
