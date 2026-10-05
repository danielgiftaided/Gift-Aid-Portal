import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireOperator } from '../../_utils/requireOperator.js'
import { supabaseAdmin } from '../../_utils/supabase.js'
import { logActivity } from '../../_utils/activityLog.js'

const REGULATORS = new Set(['CCEW', 'OSCR', 'CCNI'])

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' })
    const operator = await requireOperator(req)
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
    const name = String(body.name ?? '').trim()
    if (body.invite_email) return send(res, 400, { ok: false, error: 'Create the workspace first, then send invitations from its Onboarding tab.' })
    const regulator = String(body.regulator ?? '').trim().toUpperCase()
    const registrationNumber = String(body.registration_number ?? '').trim().toUpperCase()

    if (!name) return send(res, 400, { ok: false, error: 'Charity name is required' })
    if ((regulator && !registrationNumber) || (!regulator && registrationNumber)) {
      return send(res, 400, { ok: false, error: 'Regulator and registration number must be supplied together' })
    }
    if (regulator && !REGULATORS.has(regulator)) {
      return send(res, 400, { ok: false, error: 'Regulator must be CCEW, OSCR or CCNI' })
    }

    if (regulator) {
      const { data: duplicate, error } = await supabaseAdmin.from('charities').select('id, name')
        .eq('regulator', regulator).ilike('charity_number', registrationNumber).maybeSingle()
      if (error) throw error
      if (duplicate) return send(res, 409, { ok: false, error: `A workspace already exists for this registration: ${duplicate.name}`, charity_id: duplicate.id })
    }

    const { data: charity, error: createError } = await supabaseAdmin.from('charities').insert({
      name,
      regulator: regulator || null,
      charity_number: registrationNumber || null,
      contact_email: null,
      charity_id: null,
      authorised_official_name: null,
      created_by: operator.id,
      self_submit_enabled: false,
      onboarding_status: 'details_required',
    }).select('id, name').single()
    if (createError || !charity) throw createError ?? new Error('Charity workspace was not created')

    await logActivity({ userId: operator.id, userEmail: operator.email, action: 'charity_workspace_created', targetType: 'charity', targetId: charity.id, details: 'Workspace created; invitations are sent from its Onboarding tab' })
    return send(res, 201, { ok: true, charity })
  } catch (error: any) {
    return send(res, error?.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: error?.message ?? 'Server error' })
  }
}
