import { donationDate, numberValue, type AnalyticsRecord } from './analytics'
import { POSTCODE_AREAS, postcodeLocation, type PostcodeLocation } from './postcodeAreas'

const money = (value: number) => Math.round(value * 100) / 100
export function recordLocation(record: AnalyticsRecord): PostcodeLocation {
  if (typeof record.postcode_district === 'string') {
    const district = record.postcode_district.toUpperCase()
    const match = district.match(/^([A-Z]{1,2})\d[A-Z\d]?$/)
    if (match && match[1] === record.postcode_area && Object.prototype.hasOwnProperty.call(POSTCODE_AREAS, match[1]))
      return { postcode_area: match[1], postcode_district: district, postcode_status: 'mapped' }
  }
  if (record.postcode != null) return postcodeLocation(record.postcode)
  return { postcode_area: null, postcode_district: null,
    postcode_status: record.postcode_status === 'invalid' || record.postcode_status === 'outside_uk' ? record.postcode_status : 'missing' }
}
export function buildDonationGeography(records: AnalyticsRecord[]) {
  const groups = new Map<string, AnalyticsRecord[]>()
  let missingCount = 0, invalidCount = 0, outsideCount = 0
  for (const row of records) {
    const location = recordLocation(row)
    if (location.postcode_area) {
      const group = groups.get(location.postcode_area) || []
      group.push(row)
      groups.set(location.postcode_area, group)
    } else if (location.postcode_status === 'missing') missingCount++
    else if (location.postcode_status === 'outside_uk') outsideCount++
    else invalidCount++
  }
  const areas = Object.entries(POSTCODE_AREAS).map(([code, name]) => {
    const rows = groups.get(code) || []
    return { code, name, count: rows.length, value: money(rows.reduce((sum, row) => sum + numberValue(row.amount), 0)), rows }
  })
  return { areas, totalCount: records.length, mappedCount: records.length - missingCount - invalidCount - outsideCount,
    missingCount, invalidCount, outsideCount, unmappedCount: missingCount + invalidCount + outsideCount }
}
export type DonationGeography = ReturnType<typeof buildDonationGeography>

export function geographicDetail(rows: AnalyticsRecord[], district: string | null = null) {
  const selected = district ? rows.filter((row) => recordLocation(row).postcode_district === district) : rows
  const districts = new Map<string, { code: string; count: number; value: number }>()
  const months = new Map<string, { month: string; count: number; value: number }>()
  let undatedCount = 0
  for (const row of selected) {
    const code = recordLocation(row).postcode_district!
    const group = districts.get(code) || { code, count: 0, value: 0 }
    group.count++; group.value += numberValue(row.amount); districts.set(code, group)
    const date = donationDate(row.donation_date)
    if (!date) { undatedCount++; continue }
    const month = date.slice(0, 7)
    const item = months.get(month) || { month, count: 0, value: 0 }
    item.count++; item.value += numberValue(row.amount); months.set(month, item)
  }
  const value = money(selected.reduce((sum, row) => sum + numberValue(row.amount), 0))
  return { count: selected.length, value, average: selected.length ? money(value / selected.length) : null,
    districts: [...districts.values()].map((d) => ({ ...d, value: money(d.value) })),
    monthly: [...months.values()].map((m) => ({ ...m, value: money(m.value) })).sort((a, b) => a.month.localeCompare(b.month)),
    undatedCount }
}
