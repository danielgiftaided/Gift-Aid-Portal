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
    const email = String(body.invite_email ?? '').trim().toLowerCase()
    const regulator = String(body.regulator ?? '').trim().toUpperCase()
    const registrationNumber = String(body.registration_number ?? '').trim().toUpperCase()

    if (!name) return send(res, 400, { ok: false, error: 'Charity name is required' })
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return send(res, 400, { ok: false, error: 'Invite email is invalid' })
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

    let invitationId: string | null = null
    if (email) {
      const { data: invitation, error: invitationError } = await supabaseAdmin.from('charity_invitations').insert({
        charity_id: charity.id, email, created_by: operator.id, status: 'sent',
      }).select('id').single()
      if (invitationError || !invitation) {
        await supabaseAdmin.from('charities').delete().eq('id', charity.id)
        throw invitationError ?? new Error('Invitation was not created')
      }
      invitationId = invitation.id

      const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: 'https://portal.giftaided.com/accept-invite',
        data: { charity_id: charity.id, charity_invitation_id: invitation.id },
      })
      if (inviteError) {
        await supabaseAdmin.from('charity_invitations').delete().eq('id', invitation.id)
        await supabaseAdmin.from('charities').delete().eq('id', charity.id)
        return send(res, 400, { ok: false, error: inviteError.message })
      }
      if (invited.user?.id) await supabaseAdmin.from('charity_invitations').update({ auth_user_id: invited.user.id }).eq('id', invitation.id)
    }

    await logActivity({ userId: operator.id, userEmail: operator.email, action: 'charity_workspace_created', targetType: 'charity', targetId: charity.id, details: email ? `Invitation sent to ${email}` : 'Saved without invitation' })
    return send(res, 201, { ok: true, charity, invitation_id: invitationId })
  } catch (error: any) {
    return send(res, error?.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: error?.message ?? 'Server error' })
  }
}
