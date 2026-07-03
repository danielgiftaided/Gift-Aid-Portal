/**
 * Returns all eight XML files required for HMRC's service recognition
 * submission package, for a given submission that has completed the full
 * ETS handshake cycle. Operator-only.
 *
 * Files returned:
 *   R68_submission.xml           — the claim XML with GatewayTimestamp for LTS/recognition
 *   SUBMISSION_ACKNOWLEDGEMENT   — what HMRC's Transaction Engine returned immediately
 *   SUBMISSION_POLL              — the poll message your system sent
 *   SUBMISSION_RESPONSE          — HMRC's final accepted/rejected response
 *   DELETE_REQUEST               — the cleanup message your system sent
 *   DELETE_RESPONSE              — HMRC's response to the delete
 *   DATA_REQUEST                 — the data query message (if sendDataRequest was called)
 *   DATA_RESPONSE                — HMRC's response to the data query
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

// Injects a GatewayTimestamp into the claim XML so it validates correctly
// in LTS and is suitable for the recognition package. The timestamp must be
// 01/05/2015 per the recognition document v1.7 p4.
function addGatewayTimestamp(xml: string, date: string = '2015-05-01T00:00:00'): string {
  return xml.replace(
    /<\/MessageDetails>/,
    `<GatewayTimestamp>${date}</GatewayTimestamp>\n</MessageDetails>`
  )
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return send(res, 405, { ok: false, error: 'Method not allowed' })
    }

    await requireOperator(req)

    const submissionId = String(req.query.submission_id || '').trim()
    if (!submissionId) {
      return send(res, 400, { ok: false, error: 'submission_id query parameter is required' })
    }

    const { data, error } = await supabaseAdmin
      .from('submissions')
      .select(`
        id, tax_year, hmrc_status,
        hmrc_claim_xml,
        hmrc_acknowledgement_xml,
        hmrc_submission_poll_xml,
        hmrc_submission_response_xml,
        hmrc_delete_request_xml,
        hmrc_delete_response_xml,
        hmrc_data_request_xml,
        hmrc_data_response_xml
      `)
      .eq('id', submissionId)
      .single()

    if (error || !data) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    // The R68 submission needs the GatewayTimestamp added for the recognition
    // package — this is the LTS/recognition version, not what was sent to ETS.
    const r68WithTimestamp = data.hmrc_claim_xml
      ? addGatewayTimestamp(data.hmrc_claim_xml)
      : null

    const files = {
      'R68_submission.xml': r68WithTimestamp,
      'SUBMISSION_ACKNOWLEDGEMENT.xml': data.hmrc_acknowledgement_xml,
      'SUBMISSION_POLL.xml': data.hmrc_submission_poll_xml,
      'SUBMISSION_RESPONSE.xml': data.hmrc_submission_response_xml,
      'DELETE_REQUEST.xml': data.hmrc_delete_request_xml,
      'DELETE_RESPONSE.xml': data.hmrc_delete_response_xml,
      'DATA_REQUEST.xml': data.hmrc_data_request_xml,
      'DATA_RESPONSE.xml': data.hmrc_data_response_xml,
    }

    const missing = Object.entries(files)
      .filter(([, v]) => !v)
      .map(([k]) => k)

    return send(res, 200, {
      ok: true,
      submissionId,
      taxYear: data.tax_year,
      hmrcStatus: data.hmrc_status,
      files,
      missing,
      readyToSubmit: missing.length === 0,
      message: missing.length === 0
        ? 'All 8 files are present. Email them to SDSTeam@hmrc.gov.uk with a covering note citing Vendor ID 9330.'
        : `${missing.length} file(s) not yet captured: ${missing.join(', ')}. Complete the ETS handshake cycle to generate the missing files.`,
    })

  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, {
      ok: false,
      error: e.message ?? 'Server error',
    })
  }
}
