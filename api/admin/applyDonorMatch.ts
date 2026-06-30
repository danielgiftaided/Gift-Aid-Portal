/**
 * Applies a CONFIRMED donor match (an admin has reviewed candidates from
 * findDonorMatches.ts and explicitly chosen one) — copies contact/identity
 * fields across, and if the record is now complete, promotes it all the
 * way into a real donation attached to a submission, so it can actually
 * be claimed rather than just sitting "valid" in a staging table with
 * nowhere to go.
 *
 * Only ever copies fields that describe the PERSON (title, address,
 * postcode) — never donation_date or amount, which describe a specific
 * transaction and have no business being copied from a different
 * donation, however confident the name match is. Never overwrites a field
 * that already has a value, even if the matched record disagrees — only
 * fills genuine gaps.
 *
 * Operator-only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { logActivity } from '../_utils/activityLog.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

// Self-contained copy of the same date parsing / tax year logic used
// elsewhere (e.g. buildClaimFromSubmission.ts) — each serverless function
// is its own bundle, so this is deliberately duplicated rather than
// imported, matching the established pattern in this codebase.
function parseDonationDate(raw: string): Date | null {
  const trimmed = raw.trim()
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10)
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day)
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
    }
    return null
  }
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) {
    const year = parseInt(ymd[1], 10), month = parseInt(ymd[2], 10), day = parseInt(ymd[3], 10)
    const d = new Date(year, month - 1, day)
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d
  }
  return null
}

function getTaxYearForDate(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate()
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    const operator = await requireOperator(req)

    const body = (req as any).body ?? {}
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
    const incompleteRecordId = String(parsedBody.incomplete_record_id || '').trim()
    const matchedRecordId = String(parsedBody.matched_record_id || '').trim()

    if (!incompleteRecordId || !matchedRecordId) {
      return send(res, 400, { ok: false, error: 'incomplete_record_id and matched_record_id are both required' })
    }

    const { data: incomplete, error: incErr } = await supabaseAdmin
      .from('uploaded_records')
      .select('*')
      .eq('id', incompleteRecordId)
      .single()

    if (incErr || !incomplete) return send(res, 404, { ok: false, error: 'Incomplete record not found' })
    if (incomplete.record_status !== 'incomplete') {
      return send(res, 400, { ok: false, error: 'This record is not marked incomplete.' })
    }

    const { data: matched, error: matchedErr } = await supabaseAdmin
      .from('uploaded_records')
      .select('id, charity_id, title, address, postcode, charities(name)')
      .eq('id', matchedRecordId)
      .single()

    if (matchedErr || !matched) return send(res, 404, { ok: false, error: 'Matched record not found' })

    // Only fill genuine gaps — never overwrite something already present.
    const enriched = {
      title: incomplete.title || matched.title || null,
      address: incomplete.address || matched.address || null,
      postcode: incomplete.postcode || matched.postcode || null,
    }

    const stillMissing = [
      !incomplete.first_name ? 'First Name' : null,
      !incomplete.last_name ? 'Last Name' : null,
      !enriched.address ? 'Address' : null,
      !enriched.postcode ? 'Postcode' : null,
      !incomplete.donation_date ? 'Donation Date' : null,
      (incomplete.amount == null || incomplete.amount <= 0) ? 'Amount' : null,
    ].filter(Boolean)

    if (stillMissing.length > 0) {
      // Partial enrichment — save what we filled in, but don't promote to
      // valid or create a donation yet, since required fields remain.
      await supabaseAdmin.from('uploaded_records').update(enriched).eq('id', incompleteRecordId)
      return send(res, 200, {
        ok: true,
        promoted: false,
        message: `Some fields were filled in, but this record is still missing: ${stillMissing.join(', ')}. It remains marked incomplete.`,
      })
    }

    // Fully complete now — re-derive tax_year fresh from donation_date
    // rather than trusting any stale stored value, consistent with how
    // tax years are handled everywhere else in this codebase.
    const parsedDate = parseDonationDate(incomplete.donation_date)
    if (!parsedDate) {
      return send(res, 400, { ok: false, error: `Could not parse this record's donation date ("${incomplete.donation_date}") to determine its tax year.` })
    }
    const taxYear = getTaxYearForDate(parsedDate)

    // Find an existing pending submission for this charity + tax year, or
    // create one — mirrors the same per-tax-year grouping used at upload
    // time elsewhere in this codebase.
    const { data: existingSub } = await supabaseAdmin
      .from('submissions')
      .select('id, amount_claimed, number_of_donations')
      .eq('charity_id', incomplete.charity_id)
      .eq('tax_year', taxYear)
      .eq('status', 'pending')
      .maybeSingle()

    const giftAidValue = Math.round((incomplete.amount || 0) * 0.25 * 100) / 100
    let submissionId: string

    if (existingSub) {
      submissionId = existingSub.id
      await supabaseAdmin
        .from('submissions')
        .update({
          amount_claimed: (parseFloat(String(existingSub.amount_claimed)) || 0) + giftAidValue,
          number_of_donations: (existingSub.number_of_donations || 0) + 1,
        })
        .eq('id', submissionId)
    } else {
      const { data: newSub, error: subErr } = await supabaseAdmin
        .from('submissions')
        .insert({
          charity_id: incomplete.charity_id,
          submission_date: new Date().toISOString().split('T')[0],
          tax_year: taxYear,
          amount_claimed: giftAidValue,
          number_of_donations: 1,
          status: 'pending',
        })
        .select('id')
        .single()
      if (subErr || !newSub) return send(res, 500, { ok: false, error: subErr?.message || 'Failed to create a submission for this enriched donation.' })
      submissionId = newSub.id
    }

    const { error: donErr } = await supabaseAdmin.from('donations').insert({
      submission_id: submissionId,
      charity_id: incomplete.charity_id,
      title: enriched.title,
      first_name: incomplete.first_name,
      last_name: incomplete.last_name,
      address: enriched.address,
      postcode: enriched.postcode,
      donation_date: incomplete.donation_date,
      amount: incomplete.amount,
    })
    if (donErr) return send(res, 500, { ok: false, error: donErr.message })

    await supabaseAdmin
      .from('uploaded_records')
      .update({ ...enriched, record_status: 'valid', submission_id: submissionId, tax_year: taxYear })
      .eq('id', incompleteRecordId)

    await logActivity({
      userId: operator.id,
      userEmail: operator.email,
      action: 'donor_match_applied',
      targetType: 'uploaded_record',
      targetId: incompleteRecordId,
      details: `Enriched using a record from "${(matched as any).charities?.name || 'another charity'}" (cross-charity match). Now valid and added to a ${taxYear} submission.`,
    })

    return send(res, 200, {
      ok: true,
      promoted: true,
      message: `Record enriched and added to a ${taxYear} submission, ready to be included in a future HMRC claim.`,
    })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
