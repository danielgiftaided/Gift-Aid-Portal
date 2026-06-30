/**
 * Searches for likely donor matches across every charity's valid and
 * opted-out records, using whatever subset of first_name, last_name, and
 * postcode is actually present on the incomplete record as the search key.
 *
 * TWO IMPROVEMENTS over the initial version:
 *
 * 1. FLEXIBLE FINGERPRINT — the search key is built from whatever fields
 *    are available, not just first + last name. A record with a first name
 *    and postcode but no last name will search by those two fields. At
 *    least one of (first_name, last_name) must still be present to be
 *    worth searching — a postcode alone matches too broadly to be useful.
 *
 * 2. DEDUPLICATION — the same person may appear many times across the
 *    database (one row per donation, across multiple charities). Raw rows
 *    are grouped by (first_name, last_name, postcode) so each unique
 *    person is returned once, with the most useful record selected from
 *    each group (valid over opt-out, then most recently matched first).
 *
 * CONFIDENCE is a heuristic, not a guarantee:
 *   'high'   — all three available search fields matched (name + postcode)
 *   'medium' — name field(s) matched and result is unique (uncommon name)
 *   'low'    — name field(s) matched but multiple distinct people came back
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

    const firstName = record.first_name?.trim() || null
    const lastName  = record.last_name?.trim()  || null
    const postcode  = record.postcode?.trim().toUpperCase() || null

    // Need at least one name field to search — a postcode alone would
    // match too broadly to be useful as a fingerprint on its own.
    if (!firstName && !lastName) {
      return send(res, 200, {
        ok: true,
        candidates: [],
        searchCriteria: [],
        message: 'No name fields are present on this record — there is nothing specific enough to search by. Donor matching requires at least a first or last name.',
      })
    }

    // Build the search query dynamically from whatever fields are available.
    // Each .ilike() without wildcards is a case-insensitive exact match.
    const criteriaUsed: string[] = []
    let query = supabaseAdmin
      .from('uploaded_records')
      .select('id, charity_id, title, first_name, last_name, address, postcode, donation_date, amount, record_status, charities(name)')
      .in('record_status', ['valid', 'opt_out'])
      .neq('id', recordId)

    if (firstName) { query = query.ilike('first_name', firstName); criteriaUsed.push('first name') }
    if (lastName)  { query = query.ilike('last_name', lastName);   criteriaUsed.push('last name') }
    if (postcode)  { query = query.ilike('postcode', postcode);     criteriaUsed.push('postcode') }

    const { data: matches, error: matchErr } = await query
    if (matchErr) return send(res, 500, { ok: false, error: matchErr.message })

    const rawMatches = matches || []

    // Deduplicate — group by (first_name + last_name + postcode) so the
    // same person appearing in multiple records (multiple donations, or
    // across multiple charities) shows up only once. Within each group,
    // prefer a 'valid' record over an 'opt_out' one, so the address shown
    // is one that came from a confirmed Gift Aid declaration rather than
    // just any donation.
    const dedupeKey = (m: any): string =>
      `${(m.first_name || '').trim().toLowerCase()}|${(m.last_name || '').trim().toLowerCase()}|${(m.postcode || '').trim().toUpperCase()}`

    const groups = new Map<string, any[]>()
    for (const m of rawMatches) {
      const key = dedupeKey(m)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(m)
    }

    const fieldsSearchedCount = criteriaUsed.length
    const totalUniquePersons = groups.size

    const candidates = Array.from(groups.values()).map(group => {
      // Pick the best record from this group: valid first, then opt_out.
      const best = group.find(r => r.record_status === 'valid') ?? group[0]

      // Confidence reflects how many of the available fields were matched
      // AND how many unique people came back — more unique results means
      // more ambiguity, even when all fields matched.
      let confidence: 'high' | 'medium' | 'low'
      if (fieldsSearchedCount >= 2 && postcode) {
        // Postcode was one of the matched fields — strongest signal.
        confidence = totalUniquePersons === 1 ? 'high' : 'medium'
      } else if (totalUniquePersons === 1) {
        confidence = 'medium'
      } else {
        confidence = 'low'
      }

      return {
        id: best.id,
        charityId: best.charity_id,
        charityName: best.charities?.name || 'Unknown charity',
        title: best.title,
        firstName: best.first_name,
        lastName: best.last_name,
        address: best.address,
        postcode: best.postcode,
        donationDate: best.donation_date,
        amount: best.amount,
        recordStatus: best.record_status,
        confidence,
        appearsInRecords: group.length, // how many raw rows this person appeared in — context only
      }
    }).sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.confidence] - order[b.confidence]
    })

    return send(res, 200, {
      ok: true,
      candidates,
      searchCriteria: criteriaUsed,
      message: candidates.length === 0
        ? `No matches found searching by ${criteriaUsed.join(' + ')}.`
        : null,
    })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
