/**
 * Shared helper for writing to the activity_log table — used both for the
 * human-readable admin audit trail and (via login_failed rows specifically)
 * for computing login lockout in api/auth/login.ts.
 *
 * Deliberately fire-and-forget in spirit: a logging failure should never
 * block or fail the actual action it's describing. Callers can await it if
 * they want to be sure it landed before responding, but errors are caught
 * and only console.error'd, never thrown.
 */

import { supabaseAdmin } from './supabase.js'

export interface LogActivityParams {
  userId?: string | null
  userEmail?: string | null
  action: string
  targetType?: string | null
  targetId?: string | null
  details?: string | null
  success?: boolean
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('activity_log').insert({
      user_id: params.userId ?? null,
      user_email: params.userEmail ?? null,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      details: params.details ?? null,
      success: params.success ?? true,
    })
    if (error) console.error('logActivity failed to insert:', error.message)
  } catch (e: any) {
    console.error('logActivity threw:', e.message)
  }
}
