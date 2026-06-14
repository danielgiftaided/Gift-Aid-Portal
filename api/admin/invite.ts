import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Always return JSON
  res.setHeader('Content-Type', 'application/json')

  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'Method not allowed' })
    }

    // Verify the caller is an authenticated operator
    const authHeader = req.headers.authorization ?? ''
    const token = authHeader.replace('Bearer ', '').trim()
    if (!token) return res.status(401).json({ ok: false, error: 'Missing auth token' })

    // Use anon client to verify the session
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

    if (!supabaseUrl || !serviceRoleKey) {
      return res.status(500).json({ ok: false, error: 'Server misconfiguration: missing Supabase env vars' })
    }

    // Verify caller is logged in + is an operator
    const userClient = createClient(supabaseUrl, supabaseAnonKey)
    const { data: { user }, error: userErr } = await userClient.auth.getUser(token)
    if (userErr || !user) return res.status(401).json({ ok: false, error: 'Invalid session' })

    const adminCheck = createClient(supabaseUrl, serviceRoleKey)
    const { data: userData, error: roleErr } = await adminCheck
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single()

    if (roleErr || userData?.role !== 'operator') {
      return res.status(403).json({ ok: false, error: 'Operator access required' })
    }

    // Validate email
    const { email } = req.body ?? {}
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ ok: false, error: 'A valid email address is required' })
    }

    // Send the invite
    const { error: inviteErr } = await adminCheck.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      { redirectTo: 'https://portal.giftaided.com/accept-invite' }
    )

    if (inviteErr) return res.status(400).json({ ok: false, error: inviteErr.message })

    return res.status(200).json({ ok: true })

  } catch (e: any) {
    console.error('Invite error:', e)
    return res.status(500).json({ ok: false, error: e?.message ?? 'Unexpected server error' })
  }
}
