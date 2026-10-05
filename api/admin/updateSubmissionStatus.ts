import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireOperator } from '../_utils/requireOperator.js'
import { supabaseAdmin } from '../_utils/supabase.js'
import { logActivity } from '../_utils/activityLog.js'

const statuses = new Set(['pending', 'submitted', 'approved', 'rejected'])

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  let user
  try {
    user = await requireOperator(req)
  } catch (e: any) {
    return res.status(e.message?.includes('Forbidden') ? 403 : 401).json({ ok: false, error: 'Operator access required' })
  }
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ ok: false, error: 'Invalid JSON' })
  }
  const { submissionId, charityId, status, expectedStatus } = body ?? {}
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (typeof submissionId !== 'string' || !uuid.test(submissionId) ||
      typeof charityId !== 'string' || !uuid.test(charityId) ||
      !statuses.has(status) || !statuses.has(expectedStatus)) {
    return res.status(400).json({ ok: false, error: 'Valid submission, charity and status values are required' })
  }
  try {
    // Compare-and-set protects a newer operator or HMRC status change.
    const { data, error } = await supabaseAdmin.from('submissions')
      .update({ status })
      .eq('id', submissionId).eq('charity_id', charityId).eq('status', expectedStatus)
      .select('id, status').maybeSingle()
    if (error) throw error
    if (!data) return res.status(409).json({ ok: false, error: 'Submission changed or is unavailable. Refresh and try again.' })
    await logActivity({
      userId: user.id, userEmail: user.email, action: 'submission_status_updated',
      targetType: 'submission', targetId: submissionId,
      details: `Status changed from ${expectedStatus} to ${status}; charity ${charityId}`,
    })
    return res.status(200).json({ ok: true, submission: data })
  } catch {
    return res.status(500).json({ ok: false, error: 'Unable to save submission status' })
  }
}
