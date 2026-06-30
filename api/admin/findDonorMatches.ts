/**
 * Searches for likely matches to an incomplete donor record, across EVERY
 * charity's valid and opted-out records (cross-charity matching was a
 * deliberate choice — see project notes — accepted in exchange for a
 * larger, more useful pool of records to match against).
 *
 * IMPORTANT — this can only ever confirm "someone with this name", not
 * verify it's genuinely the same person. Confidence is a heuristic, not a
 * guarantee:
 *   'high'   — name matches AND the incomplete record's own postcode
 *              (when it has one) also matches the candidate's.
 *   'medium' — name matches and exactly one candidate was found (a
 *              reasonably uncommon name, nothing else to disambiguate).
 *   'low'    — name matches but multiple different candidates came back —
 *              a common name, genuinely ambiguous, needs real judgement.
 *
 * Matching REQUIRES a first and last name to already be present on the
 * incomplete record — there's no way to search by name for a record that
 * doesn't have one. Operator-only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const body = (req as any).body ?? {}
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
    const recordId = String(parsedBody.record_id || '').trim()

    if (!recordId) {
      return send(res, 400, { ok: false, error: 'record_id is required' })
    }

    const { data: record, error: recErr } = await supabaseAdmin
      .from('uploaded_records')
      .select('id, charity_id, first_name, last_name, postcode, record_status')
      .eq('id', recordId)
      .single()

    if (recErr || !record) {
      return send(res, 404, { ok: false, error: 'Record not found' })
    }

    if (record.record_status !== 'incomplete') {
      return send(res, 400, { ok: false, error: 'This record is not marked incomplete — nothing to match.' })
    }

    const firstName = record.first_name?.trim()
    const lastName = record.last_name?.trim()

    if (!firstName || !lastName) {
      return send(res, 200, {
        ok: true,
        candidates: [],
        message: 'This record has no first and last name on file — there is nothing to search by. Matching can only help when a name is present but other details (like address or postcode) are missing.',
      })
    }

    // .ilike() with no wildcard characters behaves as a case-insensitive
    // exact match — intentional here, not a typo for a partial search.
    const { data: matches, error: matchErr } = await supabaseAdmin
      .from('uploaded_records')
      .select('id, charity_id, title, first_name, last_name, address, postcode, donation_date, amount, record_status, charities(name)')
      .in('record_status', ['valid', 'opt_out'])
      .ilike('first_name', firstName)
      .ilike('last_name', lastName)
      .neq('id', recordId)

    if (matchErr) return send(res, 500, { ok: false, error: matchErr.message })

    const candidateList = matches || []
    const incomingPostcode = record.postcode?.trim().toUpperCase()

    const candidates = candidateList.map((m: any) => {
      const postcodeMatches = !!incomingPostcode && m.postcode?.trim().toUpperCase() === incomingPostcode
      const confidence = postcodeMatches ? 'high' : (candidateList.length === 1 ? 'medium' : 'low')
      return {
        id: m.id,
        charityId: m.charity_id,
        charityName: m.charities?.name || 'Unknown charity',
        title: m.title,
        firstName: m.first_name,
        lastName: m.last_name,
        address: m.address,
        postcode: m.postcode,
        donationDate: m.donation_date,
        amount: m.amount,
        recordStatus: m.record_status,
        confidence,
      }
    }).sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.confidence as keyof typeof order] - order[b.confidence as keyof typeof order]
    })

    return send(res, 200, { ok: true, candidates })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
