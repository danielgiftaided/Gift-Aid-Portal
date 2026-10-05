import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireOperator } from '../_utils/requireOperator.js'
import { supabaseAdmin } from '../_utils/supabase.js'
import { logActivity } from '../_utils/activityLog.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  let operator
  try { operator = await requireOperator(req) }
  catch (error: any) {
    return res.status(error.message?.includes('Forbidden') ? 403 : 401).json({ ok: false, error: 'Operator access required' })
  }
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {}) }
  catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const charityId = body.charity_id
  if (!/^\S+@\S+\.\S+$/.test(email) || typeof charityId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(charityId)) {
    return res.status(400).json({ ok: false, error: 'A valid email and charity workspace are required' })
  }
  try {
    const { data: charity, error: charityError } = await supabaseAdmin.from('charities')
      .select('id, name').eq('id', charityId).maybeSingle()
    if (charityError) throw charityError
    if (!charity) return res.status(404).json({ ok: false, error: 'Charity workspace not found' })

    // Avoid conflicting active invitations for the same verified email.
    const { data: pending, error: pendingError } = await supabaseAdmin.from('charity_invitations')
      .select('id, charity_id').eq('email', email).eq('status', 'sent')
      .gt('expires_at', new Date().toISOString()).limit(1).maybeSingle()
    if (pendingError) throw pendingError
    if (pending) return res.status(409).json({ ok: false, error: pending.charity_id === charityId
      ? 'This email already has an active invitation to this workspace.'
      : 'This email already has an active invitation to another workspace.' })

    const { data: invitation, error: invitationError } = await supabaseAdmin.from('charity_invitations')
      .insert({ charity_id: charityId, email, created_by: operator.id, status: 'sent' }).select('id').single()
    if (invitationError || !invitation) throw invitationError ?? new Error('Unable to create invitation')
    const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: 'https://portal.giftaided.com/accept-invite',
      data: { charity_id: charityId, charity_invitation_id: invitation.id },
    })
    if (inviteError) {
      const { error: cleanupError } = await supabaseAdmin.from('charity_invitations').delete().eq('id', invitation.id)
      if (cleanupError) console.error('Failed to remove unsent workspace invitation', cleanupError)
      return res.status(400).json({ ok: false, error: inviteError.message })
    }
    if (invited.user?.id) {
      const { error } = await supabaseAdmin.from('charity_invitations')
        .update({ auth_user_id: invited.user.id }).eq('id', invitation.id)
      // Account setup also resolves invitations by verified email.
      if (error) console.error('Unable to attach invited auth user', error)
    }
    await logActivity({ userId: operator.id, userEmail: operator.email, action: 'charity_invited',
      targetType: 'charity', targetId: charityId, details: `Invitation sent to ${email}` })
    return res.status(200).json({ ok: true, charity_id: charityId, invitation_id: invitation.id })
  } catch (error: any) {
    console.error('Workspace invite failed', error)
    return res.status(500).json({ ok: false, error: 'Unable to send workspace invitation' })
  }
}
