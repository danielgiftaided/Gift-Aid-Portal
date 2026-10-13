import { supabase } from '../lib/supabase'
import { fetchAllRows } from './fetchAll'
import {
  donationDate,
  recordTaxYear,
  type AnalyticsRecord,
  type AnalyticsSubmission,
  type AnalyticsCharity,
} from '../../shared/analytics'
import { giftAidRecordGroup } from '../../shared/giftAidRecords'

export interface ReportingRecord extends AnalyticsRecord {
  title?: string | null
  first_name?: string | null
  last_name?: string | null
  address?: string | null
  postcode?: string | null
}
export const REPORT_RECORD_FIELDS =
  'id, charity_id, submission_id, record_status, tax_year, amount, donation_date, title, first_name, last_name, address, postcode, gift_aid_opt_in, gift_aid_submitted'
export async function loadCharityAnalytics(charityId: string) {
  const [submissions, records] = await Promise.all([
    fetchAllRows<AnalyticsSubmission>(() =>
      supabase
        .from('submissions')
        .select(
          'id, charity_id, submission_date, status, hmrc_status, amount_claimed, number_of_donations, tax_year',
        )
        .eq('charity_id', charityId)
        .order('id', { ascending: true }),
    ),
    fetchAllRows<ReportingRecord>(() =>
      supabase
        .from('uploaded_records')
        .select(REPORT_RECORD_FIELDS)
        .eq('charity_id', charityId)
        .order('id', { ascending: true }),
    ),
  ])
  return { submissions, records }
}
export function recordCsv(rows: ReportingRecord[]): string {
  const escape = (value: unknown) => {
    let s = value == null ? '' : String(value)
    if (/^[=+@\-\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  const header = [
    'Title',
    'First Name',
    'Last Name',
    'Address',
    'Postcode',
    'Donation Date',
    'Amount',
    'Gift Aid Opt In',
    'Tax Year',
    'Gift Aid Submitted',
    'Record Group',
  ]
  return [
    header.map(escape).join(','),
    ...rows.map((r) =>
      [
        r.title,
        r.first_name,
        r.last_name,
        r.address,
        r.postcode,
        donationDate(r.donation_date) || r.donation_date,
        r.amount,
        r.gift_aid_opt_in,
        recordTaxYear(r),
        r.gift_aid_submitted === false ? 'N' : 'Y',
        giftAidRecordGroup(r),
      ]
        .map(escape)
        .join(','),
    ),
  ].join('\r\n')
}
export function downloadRecordCsv(rows: ReportingRecord[], mode: string) {
  const url = URL.createObjectURL(
    new Blob(['\uFEFF', recordCsv(rows)], { type: 'text/csv;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `gift-aid-${mode}-records.csv`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function loadPortfolioAnalytics(
  token: string,
): Promise<{
  charities: AnalyticsCharity[]
  submissions: AnalyticsSubmission[]
  records: AnalyticsRecord[]
}> {
  const request = async (url: string) => {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const json = await response.json()
    if (!response.ok || !json.ok)
      throw new Error(json.error || 'Could not load portfolio insights')
    return json
  }
  const initial = await request('/api/admin/portalInsights')
  if (!initial.analytics)
    throw new Error(
      'The reporting service needs to be deployed with this dashboard',
    )
  const records: AnalyticsRecord[] = [...initial.analytics.records]
  let offset: number | null = initial.recordsNextOffset ?? null
  while (offset != null) {
    const page = await request(
      `/api/admin/portalInsights?mode=records&offset=${offset}`,
    )
    records.push(...page.records)
    if (page.nextOffset != null && page.nextOffset <= offset)
      throw new Error('Could not advance the reporting data page')
    offset = page.nextOffset
  }
  return { ...initial.analytics, records }
}
