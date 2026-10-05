import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireOperator } from '../_utils/requireOperator.js'
import { supabaseAdmin } from '../_utils/supabase.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' })
  try { await requireOperator(req) }
  catch (error: any) {
    return res.status(error.message?.includes('Forbidden') ? 403 : 401).json({ ok: false, error: 'Operator access required' })
  }
  try {
    const invitations: any[] = []
    const pageSize = 500
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabaseAdmin.from('charity_invitations')
        .select('id, email, status, charity_id, created_at, expires_at, charities(name)')
        .in('status', ['sent', 'accepted'])
        .order('created_at', { ascending: false }).order('id', { ascending: false })
        .range(offset, offset + pageSize - 1)
      if (error) throw error
      invitations.push(...(data ?? []))
      if (!data || data.length < pageSize) break
    }
    // Staged data and verified-email invitation acceptance are keyed by email.
    // Consider the latest sent/accepted invitation so accepted resends hide old sent rows.
    const seen = new Set<string>()
    const pending = invitations.flatMap(invitation => {
      const email = String(invitation.email).trim().toLowerCase()
      if (seen.has(email)) return []
      seen.add(email)
      if (invitation.status !== 'sent') return []
      const charity = Array.isArray(invitation.charities) ? invitation.charities[0] : invitation.charities
      return [{ id: invitation.id, email, charity_id: invitation.charity_id,
        charity_name: charity?.name ?? 'Charity workspace', invited_at: invitation.created_at,
        expires_at: invitation.expires_at,
        expired: new Date(invitation.expires_at).getTime() <= Date.now() }]
    })
    return res.status(200).json({ ok: true, pending })
  } catch (error) {
    console.error('Unable to list workspace invitations', error)
    return res.status(500).json({ ok: false, error: 'Unable to load pending invitations' })
  }
}
