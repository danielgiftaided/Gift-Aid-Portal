/**
 * Returns recent activity_log entries for the admin Activity Log page.
 * Operator-only. Paginated via simple limit/offset query params.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200)
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0

    const { data, error, count } = await supabaseAdmin
      .from('activity_log')
      .select('id, created_at, user_email, action, target_type, target_id, details, success', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return send(res, 500, { ok: false, error: error.message })

    return send(res, 200, { ok: true, entries: data ?? [], total: count ?? 0 })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
