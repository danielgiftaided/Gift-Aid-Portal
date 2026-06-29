/**
 * Continues the Transaction Engine handshake for a submission that's
 * already been sent (see sendToEts.ts) — polls the stored ResponseEndPoint
 * for the final result.
 *
 * One call here is ONE poll attempt, not a loop that waits and retries
 * automatically — see sendToEts.ts for why (serverless time limits). If
 * the result is still "not ready yet", this just reports that and expects
 * to be called again later (e.g. an admin clicking "Check Status" again
 * after the suggested wait, or eventually a scheduled job).
 *
 * On a genuine final result (success or business error), this also sends
 * the required DELETE_REQUEST to let HMRC's side release the resources for
 * this CorrelationID, and updates hmrc_status accordingly.
 *
 * Operator-only, same as submitClaim.ts / sendToEts.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { postToTransactionEngine, parseGovTalkResponse, buildPollMessage, buildDeleteMessage } from '../_utils/transactionEngine.js'
import { logActivity } from '../_utils/activityLog.js'
import { deriveStatus } from '../_utils/deriveStatus.js'

const CLAIM_CLASS = 'HMRC-CHAR-CLM'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    const operator = await requireOperator(req)

    const body = (req as any).body ?? {}
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
    const submissionId = String(parsedBody.submission_id || '').trim()

    if (!submissionId) {
      return send(res, 400, { ok: false, error: 'submission_id is required' })
    }

    const { data: submission, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('id, hmrc_status, hmrc_correlation_id, hmrc_response_endpoint')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    if (!submission.hmrc_correlation_id || !submission.hmrc_response_endpoint) {
      return send(res, 400, {
        ok: false,
        error: 'This submission has no active correlation ID — it may not have been sent yet, or has already completed.',
      })
    }

    if (!['sent', 'polling'].includes(submission.hmrc_status)) {
      return send(res, 400, {
        ok: false,
        error: `This submission's status is "${submission.hmrc_status}" — nothing to poll for.`,
      })
    }

    const pollXml = buildPollMessage(CLAIM_CLASS, submission.hmrc_correlation_id)

    let responseXml: string
    try {
      responseXml = await postToTransactionEngine(pollXml, submission.hmrc_response_endpoint)
    } catch (e: any) {
      return send(res, 502, { ok: false, error: `Failed to reach the Transaction Engine for polling: ${e.message}` })
    }

    const parsed = parseGovTalkResponse(responseXml)

    // Still processing — another acknowledgement, not a final result yet.
    if (parsed.qualifier === 'acknowledgement') {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'polling',
          status: deriveStatus('polling'),
          hmrc_response_endpoint: parsed.responseEndpoint || submission.hmrc_response_endpoint,
          hmrc_poll_interval_seconds: parsed.pollIntervalSeconds || 10,
        })
        .eq('id', submissionId)

      return send(res, 200, {
        ok: true,
        status: 'polling',
        message: `Still processing — HMRC asked us to check back again in ${parsed.pollIntervalSeconds || 10} seconds.`,
      })
    }

    // Final result reached — clean up with a DELETE_REQUEST regardless of
    // success or failure, then record the outcome.
    try {
      const deleteXml = buildDeleteMessage(CLAIM_CLASS, submission.hmrc_correlation_id)
      await postToTransactionEngine(deleteXml, submission.hmrc_response_endpoint)
    } catch (e: any) {
      // Don't fail the whole request over cleanup failing — HMRC auto-
      // deletes after 30/60 days regardless, this is just tidiness.
      console.error('DELETE_REQUEST failed (non-fatal):', e.message)
    }

    if (parsed.qualifier === 'response') {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'accepted',
          status: deriveStatus('accepted'),
          hmrc_response_message: 'Accepted by HMRC.',
          hmrc_response_at: new Date().toISOString(),
        })
        .eq('id', submissionId)

      await logActivity({
        userId: operator.id, userEmail: operator.email,
        action: 'claim_status_checked', targetType: 'submission', targetId: submissionId,
        details: 'Accepted by HMRC',
      })

      return send(res, 200, { ok: true, status: 'accepted', message: 'HMRC has accepted this claim.' })
    }

    // qualifier === 'error', or anything unexpected — treat as rejected.
    const errorSummary = parsed.businessErrors.length > 0
      ? parsed.businessErrors.map(e => `[${e.number}] ${e.text}${e.location ? ` (${e.location})` : ''}`).join(' | ')
      : `Unexpected final response qualifier: ${parsed.qualifier}`

    await supabaseAdmin
      .from('submissions')
      .update({
        hmrc_status: 'rejected',
        status: deriveStatus('rejected'),
        hmrc_response_message: errorSummary,
        hmrc_response_at: new Date().toISOString(),
      })
      .eq('id', submissionId)

    await logActivity({
      userId: operator.id, userEmail: operator.email,
      action: 'claim_status_checked', targetType: 'submission', targetId: submissionId,
      success: false, details: errorSummary,
    })

    return send(res, 200, { ok: true, status: 'rejected', message: 'HMRC rejected this claim.', errors: parsed.businessErrors })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
