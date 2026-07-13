/**
 * GET  /api/admin/onboardingChecklist?charity_id=xxx  — fetch by charity_id
 * GET  /api/admin/onboardingChecklist?email=xxx       — fetch by email (pending)
 * POST /api/admin/onboardingChecklist                 — upsert fields
 *
 * The checklist is auto-created on first GET if it doesn't exist yet,
 * so there's no separate "create" step — just open the tab.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    await requireOperator(req)

    // ── GET ─────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const charityId = req.query.charity_id as string | undefined
      const email     = req.query.email      as string | undefined

      if (!charityId && !email) {
        return send(res, 400, { ok: false, error: 'charity_id or email is required' })
      }

      // Look up the charity email if we only have the ID
      let charityEmail = email
      if (charityId && !charityEmail) {
        const { data: charity } = await supabaseAdmin
          .from('charities')
          .select('contact_email')
          .eq('id', charityId)
          .single()
        charityEmail = charity?.contact_email
        if (!charityEmail) {
          return send(res, 404, { ok: false, error: 'Charity not found' })
        }
      }

      // Try to fetch existing checklist
      const { data: existing } = await supabaseAdmin
        .from('onboarding_checklists')
        .select('*')
        .eq('charity_email', charityEmail!)
        .maybeSingle()

      if (existing) return send(res, 200, { ok: true, checklist: existing })

      // Auto-create if it doesn't exist yet
      const { data: created, error: createErr } = await supabaseAdmin
        .from('onboarding_checklists')
        .insert({
          charity_email: charityEmail!,
          charity_id: charityId || null,
        })
        .select('*')
        .single()

      if (createErr) return send(res, 500, { ok: false, error: createErr.message })
      return send(res, 200, { ok: true, checklist: created })
    }

    // ── POST ────────────────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      const { charity_email, charity_id, ...fields } = body

      if (!charity_email) {
        return send(res, 400, { ok: false, error: 'charity_email is required' })
      }

      // Only allow known checklist fields to be updated
      const allowed = new Set([
        'dpa_status','proposal_status','commercial_terms_status',
        'hmrc_ref_status','charity_commission_status','chv1_status','hmrc_nominee_confirmed',
        'payment_logins_status','past_claims_status','gasds_details_status',
        'claim_built','submitted_to_hmrc','payment_received','charity_paid',
        'reporting_setup','last_contact_date','charity_id',
      ])
      const update: Record<string, any> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (allowed.has(k)) update[k] = v
      }
      if (charity_id) update.charity_id = charity_id

      const { data, error } = await supabaseAdmin
        .from('onboarding_checklists')
        .upsert({ charity_email, ...update }, { onConflict: 'charity_email' })
        .select('*')
        .single()

      if (error) return send(res, 500, { ok: false, error: error.message })
      return send(res, 200, { ok: true, checklist: data })
    }

    return send(res, 405, { ok: false, error: 'Method not allowed' })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, {
      ok: false, error: e.message ?? 'Server error',
    })
  }
}
