/**
 * Sends a DATA_REQUEST to the Transaction Engine for a given submission.
 * Required by HMRC's recognition process as one of the seven Transaction
 * Engine message files to demonstrate — you send a DATA_REQUEST and capture
 * both the message you sent (DATA_REQUEST.xml) and the response HMRC sends
 * back (DATA_RESPONSE.xml).
 *
 * This is distinct from SUBMISSION_POLL: poll is part of the primary
 * handshake for getting a result; DATA_REQUEST is a query mechanism used
 * to check submission status independently, using Function=list rather
 * than Function=submit.
 *
 * In practice this is used once for recognition purposes — you wouldn't
 * call this routinely in production since the poll/delete cycle already
 * handles everything needed for normal claim processing.
 *
 * Operator-only.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import {
  postToTransactionEngine,
  parseGovTalkResponse,
  buildDataRequestMessage,
  ETS_SUBMISSION_ENDPOINT,
} from '../_utils/transactionEngine.js'

const CLAIM_CLASS = 'HMRC-CHAR-CLM'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const body = (req as any).body ?? {}
    const parsedBody = typeof body === 'string' ? JSON.parse(body) : body
    const submissionId = String(parsedBody.submission_id || '').trim()

    if (!submissionId) {
      return send(res, 400, { ok: false, error: 'submission_id is required' })
    }

    const { data: submission, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('id, hmrc_correlation_id, hmrc_response_endpoint, hmrc_status')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    if (!submission.hmrc_correlation_id) {
      return send(res, 400, {
        ok: false,
        error: 'This submission has no HMRC CorrelationID — it needs to have been sent to ETS and acknowledged first.',
      })
    }

    const dataRequestXml = buildDataRequestMessage(CLAIM_CLASS, submission.hmrc_correlation_id)

    // Send to the response endpoint from the acknowledgement (same pattern
    // as SUBMISSION_POLL), falling back to the main ETS endpoint.
    const targetUrl = submission.hmrc_response_endpoint || ETS_SUBMISSION_ENDPOINT

    let responseXml: string
    try {
      responseXml = await postToTransactionEngine(dataRequestXml, targetUrl)
    } catch (e: any) {
      return send(res, 502, { ok: false, error: `Network error sending DATA_REQUEST: ${e.message}` })
    }

    const parsed = parseGovTalkResponse(responseXml)

    // Store both the outgoing DATA_REQUEST and the DATA_RESPONSE alongside
    // the submission record so they can be retrieved as named files for the
    // recognition submission to HMRC.
    await supabaseAdmin
      .from('submissions')
      .update({
        hmrc_data_request_xml: dataRequestXml,
        hmrc_data_response_xml: responseXml,
      })
      .eq('id', submissionId)

    return send(res, 200, {
      ok: true,
      qualifier: parsed.qualifier,
      message: `DATA_REQUEST sent and DATA_RESPONSE received (qualifier: ${parsed.qualifier}). Both stored against this submission for inclusion in the HMRC recognition package.`,
      dataRequestXml,
      dataResponseXml: responseXml,
    })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, {
      ok: false,
      error: e.message ?? 'Server error',
    })
  }
}
