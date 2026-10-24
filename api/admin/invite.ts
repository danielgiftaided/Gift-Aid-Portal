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

    // The email link can expire before the workspace invitation does. Allow
    // another send to the same workspace, but never redirect an active invite.
    const { data: pending, error: pendingError } = await supabaseAdmin.from('charity_invitations')
      .select('id, charity_id').eq('email', email).eq('status', 'sent')
      .gt('expires_at', new Date().toISOString()).limit(1).maybeSingle()
    if (pendingError) throw pendingError
    if (pending && pending.charity_id !== charityId) {
      return res.status(409).json({ ok: false, error: 'This email already has an active invitation to another workspace.' })
    }

    // Reuse expired sent rows too: their status is not automatically changed
    // when expires_at passes, so inserting another sent row can hit uniqueness
    // constraints. Retain the row and its old expiry if email delivery fails.
    const { data: previous, error: previousError } = await supabaseAdmin.from('charity_invitations')
      .select('id').eq('email', email).eq('charity_id', charityId).eq('status', 'sent')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (previousError) throw previousError
    let invitation = previous
    if (!invitation) {
      const { data, error } = await supabaseAdmin.from('charity_invitations')
        .insert({ charity_id: charityId, email, created_by: operator.id, status: 'sent' }).select('id').single()
      if (error || !data) throw error ?? new Error('Unable to create invitation')
      invitation = data
    }

    let invited
    try {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        redirectTo: 'https://portal.giftaided.com/accept-invite',
        data: { charity_id: charityId, charity_invitation_id: invitation.id },
      })
      if (error) throw error
      invited = data
    } catch (error: any) {
      if (!previous) {
        const { error: cleanupError } = await supabaseAdmin.from('charity_invitations').delete().eq('id', invitation.id)
        if (cleanupError) console.error('Failed to remove unsent workspace invitation', cleanupError)
      }
      return res.status(400).json({ ok: false, error: error.message || 'Unable to send invitation email. Please try again.' })
    }

    if (previous) {
      const sentAt = new Date()
      const { error } = await supabaseAdmin.from('charity_invitations')
        .update({
          ...(invited.user?.id ? { auth_user_id: invited.user.id } : {}),
          created_by: operator.id,
          created_at: sentAt.toISOString(),
          expires_at: new Date(sentAt.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        }).eq('id', invitation.id).eq('status', 'sent').select('id').single()
      if (error) {
        console.error('Unable to renew workspace invitation', error)
        return res.status(500).json({ ok: false, error: 'Invitation email sent, but workspace access could not be renewed. Please try again.' })
      }
    } else if (invited.user?.id) {
      const { error } = await supabaseAdmin.from('charity_invitations')
        .update({ auth_user_id: invited.user.id }).eq('id', invitation.id)
      // Account setup also resolves invitations by verified email.
      if (error) console.error('Unable to attach invited auth user', error)
    }
    await logActivity({ userId: operator.id, userEmail: operator.email, action: 'charity_invited',
      targetType: 'charity', targetId: charityId, details: `Invitation ${previous ? 'resent' : 'sent'} to ${email}` })
    return res.status(200).json({ ok: true, charity_id: charityId, invitation_id: invitation.id, resent: Boolean(previous) })
  } catch (error: any) {
    console.error('Workspace invite failed', error)
    return res.status(500).json({ ok: false, error: 'Unable to send workspace invitation' })
  }
}
