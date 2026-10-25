import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireOperator } from '../_utils/requireOperator.js'
import { supabaseAdmin } from '../_utils/supabase.js'
import { logActivity } from '../_utils/activityLog.js'
import { deriveStatus } from '../_utils/deriveStatus.js'
import { isHmrcStatus } from '../../shared/hmrcStatus.js'

const statuses = new Set(['pending', 'submitted', 'approved', 'rejected'])
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }
  let operator
  try { operator = await requireOperator(req) }
  catch (error: any) {
    return res.status(error.message?.includes('Forbidden') ? 403 : 401)
      .json({ ok: false, error: 'Operator access required' })
  }
  let body
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body }
  catch { return res.status(400).json({ ok: false, error: 'Invalid JSON' }) }
  const { submissionId, charityId, hmrcStatus, expectedHmrcStatus, expectedStatus } = body ?? {}
  if (typeof submissionId !== 'string' || !uuid.test(submissionId) ||
      typeof charityId !== 'string' || !uuid.test(charityId) ||
      !isHmrcStatus(hmrcStatus) ||
      !(expectedHmrcStatus === null || isHmrcStatus(expectedHmrcStatus)) ||
      !statuses.has(expectedStatus)) {
    return res.status(400).json({ ok: false, error: 'Valid submission, charity and status values are required' })
  }
  // Only the claim builder can establish that XML has passed validation.
  if (hmrcStatus === 'ready_to_send') {
    return res.status(400).json({ ok: false, error: 'Use Build HMRC Claim to mark a claim ready to send.' })
  }
  try {
    // Save both values together and protect changes made in another session
    // or by HMRC processing since the operator loaded the submission.
    let query = supabaseAdmin.from('submissions')
      .update({ hmrc_status: hmrcStatus, status: deriveStatus(hmrcStatus) })
      .eq('id', submissionId).eq('charity_id', charityId).eq('status', expectedStatus)
    query = expectedHmrcStatus === null
      ? query.is('hmrc_status', null)
      : query.eq('hmrc_status', expectedHmrcStatus)
    const { data, error } = await query.select('id, status, hmrc_status').maybeSingle()
    if (error) throw error
    if (!data) return res.status(409).json({ ok: false, error: 'Submission changed or is unavailable. Refresh and try again.' })
    await logActivity({
      userId: operator.id, userEmail: operator.email, action: 'submission_hmrc_status_updated',
      targetType: 'submission', targetId: submissionId,
      details: `HMRC status changed from ${expectedHmrcStatus ?? 'not_submitted'} to ${hmrcStatus}; status ${expectedStatus} to ${data.status}; charity ${charityId}`,
    })
    return res.status(200).json({ ok: true, submission: data })
  } catch {
    return res.status(500).json({ ok: false, error: 'Unable to save HMRC status' })
  }
}
