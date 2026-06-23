/**
 * Orchestrates building (and, once live transport is enabled, sending) an
 * HMRC Charities Online claim for a single submission.
 *
 * Pipeline: fetch data -> map to claim shape -> build XML -> compute IRmark
 * -> splice IRmark in -> [STUBBED] send to HMRC -> store result.
 *
 * Operator-only — this is deliberately not exposed to charity users. Direct
 * HMRC submission is consequential enough that a human at Gift Aided should
 * be the one triggering it, at least until this has a real track record.
 *
 * LIVE TRANSPORT IS DELIBERATELY DISABLED until:
 *   1. SDST has confirmed whose Gateway credentials populate SenderID
 *      (the charity's own enrolment, or an agent-specific identity).
 *   2. The Local Test Service has validated this XML structure against the
 *      real schema and business rules (this codebase's structure is built
 *      from the documentation, not yet checked against the authoritative
 *      LTS tool).
 *   3. External Test Service credentials are available to test the actual
 *      network transport before anything touches live data.
 *
 * Until all three are true, this endpoint builds the XML, verifies the
 * IRmark, and stores everything for review with hmrc_status='ready_to_send'
 * — it does not transmit anything anywhere.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_utils/supabase.js'
import { requireOperator } from '../_utils/requireOperator.js'
import { buildClaimFromSubmission, CharityRow, SubmissionRow, DonationRow } from '../_utils/buildClaimFromSubmission.js'
import { buildR68Submission, SubmissionCredentials } from '../_utils/r68XmlBuilder.js'
import { generateIrmark } from '../_utils/irmark.js'

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

/**
 * STUBBED transport function. Deliberately throws rather than attempting a
 * real network call — see file header for exactly what needs to be true
 * before this should do anything else.
 *
 * When ready to enable: this is where an HTTP POST to either the External
 * Test Service or the live Transaction Engine URL belongs, along with
 * handling the GovTalk poll-based response flow (an initial acknowledgement
 * with a correlation ID, followed by polling for the final accepted/
 * rejected outcome) — do not assume a single synchronous request/response.
 */
async function sendToHmrc(_finalXml: string): Promise<never> {
  throw new Error(
    'Live HMRC transport is not yet enabled. See the file header in api/admin/submitClaim.ts for what needs confirming first (SDST credentials question, LTS validation, ETS access).'
  )
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

    // Fetch the submission
    const { data: submission, error: subErr } = await supabaseAdmin
      .from('submissions')
      .select('id, charity_id, tax_year, status, hmrc_status')
      .eq('id', submissionId)
      .single()

    if (subErr || !submission) {
      return send(res, 404, { ok: false, error: 'Submission not found' })
    }

    // Fetch the charity
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from('charities')
      .select('id, name, charity_id, authorised_official_name')
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
      .select('id, title, first_name, last_name, address, postcode, amount')
      .eq('submission_id', submissionId)

    if (donErr) {
      return send(res, 500, { ok: false, error: donErr.message })
    }

    // ── Step 1: map + validate ──────────────────────────────
    const mapping = buildClaimFromSubmission(
      charity as CharityRow,
      submission as SubmissionRow,
      (donations || []) as DonationRow[]
    )

    if (mapping.errors.length > 0 || !mapping.claim) {
      await supabaseAdmin
        .from('submissions')
        .update({
          hmrc_status: 'validation_failed',
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
    // NOTE: credentials below are placeholders. SenderID/password source is
    // the unresolved open question — see file header. Using empty strings
    // here is intentional: this keeps the XML structurally complete enough
    // to compute the IRmark from (which doesn't depend on these values)
    // without pretending we have real credentials to submit with.
    const credentials: SubmissionCredentials = {
      vendorId: process.env.HMRC_VENDOR_ID || '9330',
      productName: process.env.HMRC_PRODUCT_NAME || 'Gift Aided Portal',
      productVersion: process.env.HMRC_PRODUCT_VERSION || '1.0',
      senderId: process.env.HMRC_SENDER_ID || '',
      senderPassword: process.env.HMRC_SENDER_PASSWORD || '',
      isLive: false, // always test-mode (GatewayTest=1) until this is explicitly revisited
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
          hmrc_response_message: `IRmark generation failed: ${e.message}`,
        })
        .eq('id', submissionId)

      return send(res, 500, { ok: false, error: `IRmark generation failed: ${e.message}` })
    }

    // ── Step 4: store the built claim, ready for review ─────
    // Live transport is intentionally not attempted — see sendToHmrc().
    await supabaseAdmin
      .from('submissions')
      .update({
        hmrc_status: 'ready_to_send',
        hmrc_claim_xml: finalXml,
        hmrc_built_at: new Date().toISOString(),
        hmrc_response_message: mapping.warnings.length > 0 ? `Built with warnings: ${mapping.warnings.join(' | ')}` : null,
      })
      .eq('id', submissionId)

    return send(res, 200, {
      ok: true,
      status: 'ready_to_send',
      message: 'Claim XML built and IRmark verified. Not yet sent to HMRC — live transport is not enabled.',
      warnings: mapping.warnings,
      donationCount: mapping.claim.donations.length,
    })
  } catch (e: any) {
    return send(res, e.message?.includes('Forbidden') ? 403 : 500, { ok: false, error: e.message ?? 'Server error' })
  }
}
