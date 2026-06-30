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

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const { data: charities, error: charErr } = await supabaseAdmin
      .from('charities')
      .select('id, name')

    if (charErr) return send(res, 500, { ok: false, error: charErr.message })

    const { data: submissions, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('charity_id, amount_claimed, number_of_donations, status')

    if (subErr) return send(res, 500, { ok: false, error: subErr.message })

    const totalGiftAidClaimed = (submissions || []).reduce((sum, s) => sum + (parseFloat(String(s.amount_claimed)) || 0), 0)
    const totalDonations = (submissions || []).reduce((sum, s) => sum + (s.number_of_donations || 0), 0)
    const totalApproved = (submissions || []).filter(s => s.status === 'approved').length

    // Per-charity breakdown — gives admins something to scan beyond just
    // the one headline figure, consistent with how every other Insights
    // page in this portal pairs a top-line number with supporting detail.
    const byCharity: Record<string, { name: string; giftAid: number; submissions: number }> = {}
    for (const c of charities || []) {
      byCharity[c.id] = { name: c.name, giftAid: 0, submissions: 0 }
    }
    for (const s of submissions || []) {
      if (!byCharity[s.charity_id]) continue // submission belongs to a charity no longer present — skip rather than crash
      byCharity[s.charity_id].giftAid += parseFloat(String(s.amount_claimed)) || 0
      byCharity[s.charity_id].submissions += 1
    }

    const charityBreakdown = Object.values(byCharity).sort((a, b) => b.giftAid - a.giftAid)

    return send(res, 200, {
      ok: true,
      totalCharities: (charities || []).length,
      totalSubmissions: (submissions || []).length,
      totalGiftAidClaimed,
      totalDonations,
      totalApproved,
      charityBreakdown,
    })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
