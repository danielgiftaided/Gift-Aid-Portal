/**
 * Lists incomplete donor records across EVERY charity in the portal —
 * the starting point for donor matching/enrichment. Operator-only.
 *
 * Deliberately portal-wide rather than scoped to one charity, matching the
 * cross-charity search scope chosen for the matching feature itself —
 * worth keeping consistent, since a charity-scoped list feeding a
 * cross-charity search would be a confusing mismatch.
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

    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0

    const { data, error, count } = await supabaseAdmin
      .from('uploaded_records')
      .select('id, charity_id, title, first_name, last_name, address, postcode, donation_date, amount, tax_year, charities(name)', { count: 'exact' })
      .eq('record_status', 'incomplete')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return send(res, 500, { ok: false, error: error.message })

    const records = (data || []).map((r: any) => ({
      id: r.id,
      charityId: r.charity_id,
      charityName: r.charities?.name || 'Unknown charity',
      title: r.title,
      firstName: r.first_name,
      lastName: r.last_name,
      address: r.address,
      postcode: r.postcode,
      donationDate: r.donation_date,
      amount: r.amount,
      taxYear: r.tax_year,
      missingFields: [
        !r.first_name ? 'First Name' : null,
        !r.last_name ? 'Last Name' : null,
        !r.address ? 'Address' : null,
        !r.postcode ? 'Postcode' : null,
        !r.donation_date ? 'Donation Date' : null,
        (r.amount == null || r.amount <= 0) ? 'Amount' : null,
      ].filter(Boolean),
    }))

    return send(res, 200, { ok: true, records, total: count ?? 0 })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
