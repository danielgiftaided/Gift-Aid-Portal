import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase'
import { requireOperator } from '../_utils/requireOperator'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const user = await requireOperator(req, res)
  if (!user) return

  const { email } = req.body
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ ok: false, error: 'A valid email address is required' })
  }

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email.trim().toLowerCase(), {
    redirectTo: 'https://portal.giftaided.com/accept-invite',
  })

  if (error) return res.status(400).json({ ok: false, error: error.message })

  return res.status(200).json({ ok: true })
}
