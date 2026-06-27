/**
 * Server-side login endpoint — replaces calling supabase.auth.signInWithPassword
 * directly from the browser. This exists specifically to give us a checkpoint
 * to (a) enforce login lockout after repeated failed attempts, and (b) log
 * every login attempt to the activity audit trail.
 *
 * The frontend calls this instead of the Supabase client directly, then
 * takes the returned access/refresh tokens and calls
 * supabase.auth.setSession() to hydrate its local client — everything
 * downstream (MFA challenge/setup, role-based routing) is unchanged.
 *
 * Lockout model: count failed attempts for this email in the last 15
 * minutes; 5 or more blocks further attempts until enough time has passed
 * for the window to roll forward. Deliberately a rolling window rather than
 * a separate "locked until" timestamp — simpler, and self-resolving.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '../_utils/supabase.js'
import { logActivity } from '../_utils/activityLog.js'

const LOCKOUT_WINDOW_MINUTES = 15
const MAX_FAILED_ATTEMPTS = 5

function send(res: VercelResponse, status: number, body: object) {
  res.setHeader('Content-Type', 'application/json')
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    const body = (req as any).body ?? {}
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
    const email = String(parsedBody.email || '').trim().toLowerCase()
    const password = String(parsedBody.password || '')

    if (!email || !password) {
      return send(res, 400, { ok: false, error: 'Email and password are required' })
    }

    // ── Lockout check ────────────────────────────────────────
    const windowStart = new Date(Date.now() - LOCKOUT_WINDOW_MINUTES * 60 * 1000).toISOString()
    const { count: failedCount, error: countErr } = await supabaseAdmin
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'login_failed')
      .eq('user_email', email)
      .gte('created_at', windowStart)

    if (countErr) {
      console.error('Lockout check failed (allowing login to proceed):', countErr.message)
    } else if ((failedCount ?? 0) >= MAX_FAILED_ATTEMPTS) {
      await logActivity({ userEmail: email, action: 'login_blocked_lockout', success: false })
      return send(res, 429, {
        ok: false,
        error: `Too many failed login attempts. Please wait ${LOCKOUT_WINDOW_MINUTES} minutes before trying again.`,
      })
    }

    // ── Attempt authentication ───────────────────────────────
    const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? ''
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? ''
    const authClient = createClient(supabaseUrl, supabaseAnonKey)

    const { data, error: authError } = await authClient.auth.signInWithPassword({ email, password })

    if (authError || !data.session) {
      await logActivity({ userEmail: email, action: 'login_failed', success: false, details: authError?.message ?? 'No session returned' })
      // Deliberately generic — never confirm or deny whether an account exists for this email.
      return send(res, 401, { ok: false, error: 'Invalid email or password' })
    }

    await logActivity({ userId: data.user?.id, userEmail: email, action: 'login_success', success: true })

    return send(res, 200, {
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    })

  } catch (e: any) {
    console.error('Login endpoint error:', e)
    return send(res, 500, { ok: false, error: 'Server error' })
  }
}
