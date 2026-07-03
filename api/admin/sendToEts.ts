/**
 * Sends an already-built claim (produced by submitClaim.ts) to HMRC's
 * External Test Service, and handles the first step of the asynchronous
 * handshake — the SUBMISSION_REQUEST and resulting
 * SUBMISSION_ACKNOWLEDGEMENT.
 *
 * This deliberately does NOT loop and poll within this same request. The
 * Transaction Engine tells us how long to wait (PollInterval) before
 * checking again, which could be many seconds — holding a serverless
 * function open that long just to wait is wasteful and risks hitting
 * Vercel's execution time limit. Instead, this stores the CorrelationID
 * and ResponseEndPoint and stops; a separate call to pollClaim.ts (likely
 * triggered by an admin clicking "Check Status") continues the handshake.
 *
 * Operator-only, same as submitClaim.ts.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { postToTransactionEngine, parseGovTalkResponse, ETS_SUBMISSION_ENDPOINT } from '../_utils/transactionEngine.js'
import { logActivity } from '../_utils/activityLog.js'
import { deriveStatus } from '../_utils/deriveStatus.js'

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
      .select('id, hmrc_status, hmrc_claim_xml')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    if (!submission.hmrc_claim_xml) {
      return send(res, 400, {
        ok: false,
        error: 'This submission has no built claim XML yet — use "Build HMRC Claim" first.',
      })
    }

    if (submission.hmrc_status !== 'ready_to_send') {
      return send(res, 400, {
        ok: false,
        error: `This submission's status is "${submission.hmrc_status}", not "ready_to_send" — refusing to send again to avoid an accidental duplicate submission. Rebuild the claim first if you genuinely intend to resend it.`,
      })
    }

    let responseXml: string
    try {
      responseXml = await postToTransactionEngine(submission.hmrc_claim_xml, ETS_SUBMISSION_ENDPOINT)
    } catch (e: any) {
      await supabaseAdmin
        .from('submissions')
        .update({ hmrc_status: 'error', status: deriveStatus('error'), hmrc_response_message: `Network error sending to ETS: ${e.message}` })
        .eq('id', submissionId)
      return send(res, 502, { ok: false, error: `Failed to reach the External Test Service: ${e.message}` })
    }

    const parsed = parseGovTalkResponse(responseXml)

    if (parsed.qualifier === 'acknowledgement' && parsed.correlationId && parsed.responseEndpoint) {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'sent',
          status: deriveStatus('sent'),
          hmrc_correlation_id: parsed.correlationId,
          hmrc_response_endpoint: parsed.responseEndpoint,
          hmrc_poll_interval_seconds: parsed.pollIntervalSeconds || 10,
          hmrc_submitted_at: new Date().toISOString(),
          hmrc_response_message: null,
          hmrc_acknowledgement_xml: responseXml, // SUBMISSION_ACKNOWLEDGEMENT
        })
        .eq('id', submissionId)

      await logActivity({
        userId: operator.id,
        userEmail: operator.email,
        action: 'claim_sent_to_ets',
        targetType: 'submission',
        targetId: submissionId,
        details: `Correlation ID: ${parsed.correlationId}`,
      })

      return send(res, 200, {
        ok: true,
        status: 'sent',
        message: `Submitted successfully. HMRC acknowledged receipt and asked us to check back in ${parsed.pollIntervalSeconds || 10} seconds.`,
        correlationId: parsed.correlationId,
      })
    }

    // Got an immediate error rather than an acknowledgement — store and report it.
    const errorSummary = parsed.businessErrors.length > 0
      ? parsed.businessErrors.map(e => `[${e.number}] ${e.text}${e.location ? ` (${e.location})` : ''}`).join(' | ')
      : `Unexpected response qualifier: ${parsed.qualifier}`

    await supabaseAdmin
      .from('submissions')
      .update({ hmrc_status: 'rejected', status: deriveStatus('rejected'), hmrc_response_message: errorSummary })
      .eq('id', submissionId)

    await logActivity({
      userId: operator.id,
      userEmail: operator.email,
      action: 'claim_sent_to_ets',
      targetType: 'submission',
      targetId: submissionId,
      success: false,
      details: errorSummary,
    })

    return send(res, 400, { ok: false, error: 'ETS rejected the submission immediately.', errors: parsed.businessErrors, rawResponse: responseXml })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
