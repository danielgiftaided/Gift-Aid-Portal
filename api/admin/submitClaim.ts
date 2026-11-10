/**
 * Builds an HMRC Charities Online claim for a single submission.
 *
 * Pipeline: fetch data -> map to claim shape -> build XML -> compute IRmark
 * -> splice IRmark in -> store the exact claim ready for an operator to send.
 *
 * HMRC confirmed in November 2026 that Gift Aided may begin live filing
 * immediately. Production routing is:
 *   Vendor ID: 9330
 *   Product: GiftAided
 *   Version: 1.0
 *
 * Live filing still requires Gift Aided's separate Charities for Agents
 * production credentials and the explicit HMRC_LIVE_ENABLED=true server-side
 * feature flag. Charity Government Gateway credentials are never collected;
 * HMRC identifies the charity/authorisation through CHARID/HMRCref and the
 * per-charity Agent/Nominee reference held against the charity.
 *
 * Operator-only: building and sending live claims remains a deliberate human
 * action to reduce duplicate or accidental submissions.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { buildClaimFromSubmission, CharityRow, SubmissionRow, DonationRow, GasdsRow, OtherIncomeRow } from '../_utils/buildClaimFromSubmission.js'
import { buildR68Submission, SubmissionCredentials } from '../_utils/r68XmlBuilder.js'
import { generateIrmark } from '../_utils/irmark.js'
import { deriveStatus } from '../_utils/deriveStatus.js'
import { logActivity } from '../_utils/activityLog.js'

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body)
}

/** Splices a computed IRmark value into the empty placeholder element left by buildR68Submission. */
function spliceIrmark(xml: string, irmarkBase64: string): string {
  return xml.replace(
    /<IRmark Type="generic"><\/IRmark>/,
    `<IRmark Type="generic">${irmarkBase64}</IRmark>`
  )
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
    const requestedEnvironment = String(parsedBody.environment || 'test').trim().toLowerCase()
    if (!['test', 'live'].includes(requestedEnvironment)) {
      return send(res, 400, { ok: false, error: 'environment must be either test or live' })
    }
    const isLive = requestedEnvironment === 'live'

    if (isLive && process.env.HMRC_LIVE_ENABLED !== 'true') {
      return send(res, 409, {
        ok: false,
        error: 'Live HMRC submission is disabled by the production safety flag. Set HMRC_LIVE_ENABLED=true only when Gift Aided's live Agent credentials are configured.',
      })
    }

    if (!submissionId) {
      return send(res, 400, { ok: false, error: 'submission_id is required' })
    }

    // Fetch the submission
    const { data: submission, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('id, charity_id, tax_year, status, hmrc_status, adjustment_amount, adjustment_explanation')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    if (['sent', 'polling'].includes(submission.hmrc_status)) {
      return send(res, 409, { ok: false, error: 'Finish polling the active HMRC submission before rebuilding its claim.' })
    }

    // Fetch the charity
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from('charities')
      .select('id, name, charity_id, charity_number, authorised_official_name, agent_nominee_reference')
      .eq('id', submission.charity_id)
      .single()

    if (charityErr || !charity) {
      return send(res, 404, { ok: false, error: 'Charity not found for this submission' })
    }

    // Fetch the donations belonging to this submission (these are already
    // only ever 'valid' rows by the time a submission exists — see
    // adminCharityDetail.tsx / api/charity/setup.ts where submissions are
    // created)
    const { data: donations, error: donErr } = await supabaseAdmin
      .from('donations')
      .select('id, title, first_name, last_name, address, postcode, donation_date, amount, aggregated, aggregated_description, sponsored')
      .eq('submission_id', submissionId)

    if (donErr) {
      return send(res, 500, { ok: false, error: donErr.message })
    }

    // GASDS is entirely separate from donations — fetch it independently.
    // .maybeSingle() rather than .single() since most submissions won't
    // have one at all, which is normal, not an error.
    const { data: gasdsRow, error: gasdsErr } = await supabaseAdmin
      .from('gasds_claims')
      .select('claim_year, amount, connected_charities, connected_charity_details, community_buildings, community_building_details, adjustment, adjustment_explanation')
      .eq('submission_id', submissionId)
      .maybeSingle()

    if (gasdsErr) {
      return send(res, 500, { ok: false, error: gasdsErr.message })
    }

    // Other income (e.g. covenanted payments) — also separate from donations.
    // Gracefully treated as empty if the table doesn't exist yet.
    let otherIncomeRows: OtherIncomeRow[] = []
    try {
      const { data: oiData } = await supabaseAdmin
        .from('other_income')
        .select('id, payer, date, gross_amount, tax_deducted')
        .eq('submission_id', submissionId)
      otherIncomeRows = (oiData || []) as OtherIncomeRow[]
    } catch {
      // Table doesn't exist yet — not a blocking error, simply no other income
    }

    // ── Step 1: map + validate ──────────────────────────────
    const mapping = buildClaimFromSubmission(
      charity as CharityRow,
      submission as SubmissionRow,
      (donations || []) as DonationRow[],
      gasdsRow as GasdsRow | null,
      otherIncomeRows
    )

    if (mapping.errors.length > 0 || !mapping.claim) {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'validation_failed',
          status: deriveStatus('validation_failed'),
          hmrc_response_message: mapping.errors.join(' | '),
        })
        .eq('id', submissionId)

      return send(res, 400, {
        ok: false,
        error: 'Claim failed validation before it could be built — see errors.',
        errors: mapping.errors,
        warnings: mapping.warnings,
      })
    }

    // ── Step 2: build the XML with a placeholder IRmark ─────
    // Credentials are Gift Aided's own Agent credentials, not per-charity.
    // HMRC confirmed Vendor ID 9330 and left the product name/version to us.
    const credentials: SubmissionCredentials = {
      vendorId: process.env.HMRC_VENDOR_ID || '9330',
      productName: process.env.HMRC_PRODUCT_NAME || 'GiftAided',
      productVersion: process.env.HMRC_PRODUCT_VERSION || '1.0',
      senderId: process.env.HMRC_SENDER_ID || '',
      senderPassword: process.env.HMRC_SENDER_PASSWORD || '',
      isLive, // live => omit GatewayTest; test => GatewayTest=1
      // Gift Aided's OWN details as the agent — confirmed required by the
      // real schema's AgtOrNom structure. Must be set before any real
      // submission; empty strings here will fail schema validation
      // (Postcode/Phone are both mandatory, non-empty fields).
      agentOrgName: process.env.HMRC_AGENT_ORG_NAME || 'Gift Aided Ltd',
      agentPostcode: process.env.HMRC_AGENT_POSTCODE || '',
      agentPhone: process.env.HMRC_AGENT_PHONE || '',
    }

    if (!credentials.agentPostcode || !credentials.agentPhone) {
      return send(res, 500, {
        ok: false,
        error: 'HMRC_AGENT_POSTCODE and/or HMRC_AGENT_PHONE are not configured. The real R68 schema requires Gift Aided\'s own postcode and phone number on every claim (the AgtOrNom structure) — set these in Vercel environment variables before building any claim.',
      })
    }

    if (isLive && (!credentials.senderId || !credentials.senderPassword || !credentials.vendorId || !credentials.productName || !credentials.productVersion)) {
      return send(res, 500, {
        ok: false,
        error: 'Live HMRC credentials/product routing are incomplete. Configure HMRC_SENDER_ID, HMRC_SENDER_PASSWORD, HMRC_VENDOR_ID, HMRC_PRODUCT_NAME and HMRC_PRODUCT_VERSION before building a live claim.',
      })
    }

    const xmlWithPlaceholder = buildR68Submission(mapping.claim, credentials)

    // ── Step 3: compute the (now-verified) IRmark and splice it in ──
    let finalXml: string
    try {
      const irmark = generateIrmark(xmlWithPlaceholder)
      finalXml = spliceIrmark(xmlWithPlaceholder, irmark.base64)
    } catch (e: any) {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'error',
          status: deriveStatus('error'),
          hmrc_response_message: `IRmark generation failed: ${e.message}`,
        })
        .eq('id', submissionId)

      return send(res, 500, { ok: false, error: `IRmark generation failed: ${e.message}` })
    }

    // ── Step 4: store the built claim, ready for review/send ─────
    await supabaseAdmin
      .from('submissions')
      .update({
        hmrc_status: 'ready_to_send',
        status: deriveStatus('ready_to_send'),
        hmrc_environment: requestedEnvironment,
        hmrc_claim_xml: finalXml,
        // Evidence belongs to this exact claim. A rebuilt claim needs a new
        // handshake; do not export responses captured for an earlier body.
        hmrc_correlation_id: null,
        hmrc_response_endpoint: null,
        hmrc_acknowledgement_xml: null,
        hmrc_submission_poll_xml: null,
        hmrc_submission_response_xml: null,
        hmrc_delete_request_xml: null,
        hmrc_delete_response_xml: null,
        hmrc_data_request_xml: null,
        hmrc_data_response_xml: null,
        hmrc_built_at: new Date().toISOString(),
        hmrc_response_message: mapping.warnings.length > 0 ? `Built with warnings: ${mapping.warnings.join(' | ')}` : null,
      })
      .eq('id', submissionId)

    await logActivity({
      userId: operator.id,
      userEmail: operator.email,
      action: 'claim_built',
      targetType: 'submission',
      targetId: submissionId,
      details: mapping.warnings.length > 0 ? `Built with warnings: ${mapping.warnings.join(' | ')}` : 'Built cleanly',
    })

    return send(res, 200, {
      ok: true,
      status: 'ready_to_send',
      message: isLive ? 'Live claim XML built and IRmark verified. Ready for submission to HMRC.' : 'Test claim XML built and IRmark verified. Ready for ETS submission.',
      warnings: mapping.warnings,
      donationCount: mapping.claim.donations.length,
    })
  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
