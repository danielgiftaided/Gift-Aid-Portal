/**
 * Aggregates Gift Aid figures across EVERY charity in the portal — the
 * admin-wide counterpart to the per-charity insights already available at
 * /admin/charities/:id/insights. Operator-only.
 *
 * "Gift Aid Claimed" here follows the same convention used everywhere else
 * in this portal: the sum of submissions.amount_claimed, regardless of
 * HMRC status — i.e. what's been recorded/submitted through the portal in
 * total, not filtered down to only HMRC-accepted claims. This matches how
 * the per-charity admin page and the charity-facing Insights page both
 * already define this figure, so the numbers stay consistent wherever an
 * admin sees them.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { postcodeLocation } from '../../shared/postcodeAreas.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const mode = req.query?.mode
    if (mode && mode !== 'records')
      return send(res, 400, { ok: false, error: 'Unknown report data mode' })
    const offset = Number(req.query?.offset ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0)
      return send(res, 400, { ok: false, error: 'Invalid record offset' })
    async function readRecordPage(from: number) {
      const { data, error } = await supabaseAdmin
        .from('uploaded_records')
        .select(
          'id, charity_id, submission_id, amount, donation_date, tax_year, record_status, gift_aid_opt_in, gift_aid_submitted, postcode',
        )
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error)
        throw new Error(
          `Could not load uploaded record reporting data: ${error.message}`,
        )
      return {
        records: (data || []).map((row) => ({
          id: row.id, charity_id: row.charity_id, submission_id: row.submission_id,
          amount: row.amount, donation_date: row.donation_date, tax_year: row.tax_year,
          record_status: row.record_status, gift_aid_opt_in: row.gift_aid_opt_in,
          gift_aid_submitted: row.gift_aid_submitted,
          ...postcodeLocation(row.postcode),
        })),
        nextOffset: data?.length === 1000 ? from + 1000 : null,
      }
    }
    if (mode === 'records')
      return send(res, 200, { ok: true, ...(await readRecordPage(offset)) })

    // Page all sources in a stable order; PostgREST otherwise silently
    // truncates each table at its response limit. Never return donor PII.
    async function readAll(table: string, fields: string): Promise<any[]> {
      const rows: any[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select(fields)
          .order('id', { ascending: true })
          .range(offset, offset + 999)
        if (error)
          throw new Error(
            `Could not load ${table} reporting data: ${error.message}`,
          )
        rows.push(...(data || []))
        if (!data || data.length < 1000) return rows
      }
    }
    const [charities, submissions, recordPage] = await Promise.all([
      readAll('charities', 'id, name'),
      readAll(
        'submissions',
        'id, charity_id, amount_claimed, number_of_donations, status, hmrc_status, tax_year, submission_date',
      ),
      readRecordPage(0),
    ])

    const totalGiftAidClaimed = (submissions || []).reduce(
      (sum, s) => sum + (parseFloat(String(s.amount_claimed)) || 0),
      0,
    )
    const totalDonations = (submissions || []).reduce(
      (sum, s) => sum + (s.number_of_donations || 0),
      0,
    )
    const totalApproved = (submissions || []).filter(
      (s) => s.status === 'approved',
    ).length

    // Per-charity breakdown — gives admins something to scan beyond just
    // the one headline figure, consistent with how every other Insights
    // page in this portal pairs a top-line number with supporting detail.
    const byCharity: Record<
      string,
      { name: string; giftAid: number; submissions: number }
    > = {}
    for (const c of charities || []) {
      byCharity[c.id] = { name: c.name, giftAid: 0, submissions: 0 }
    }
    for (const s of submissions || []) {
      if (!byCharity[s.charity_id]) continue // submission belongs to a charity no longer present — skip rather than crash
      byCharity[s.charity_id].giftAid +=
        parseFloat(String(s.amount_claimed)) || 0
      byCharity[s.charity_id].submissions += 1
    }

    const charityBreakdown = Object.values(byCharity).sort(
      (a, b) => b.giftAid - a.giftAid,
    )

    return send(res, 200, {
      ok: true,
      analytics: { charities, submissions, records: recordPage.records },
      recordsNextOffset: recordPage.nextOffset,
      totalCharities: (charities || []).length,
      totalSubmissions: (submissions || []).length,
      totalGiftAidClaimed,
      totalDonations,
      totalApproved,
      charityBreakdown,
    })
  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, {
      ok: false,
      error: e.message ?? 'Server error',
    })
  }
}
