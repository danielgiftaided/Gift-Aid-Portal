/**
 * Implements the parts of HMRC's Transaction Engine Document Submission
 * Protocol needed beyond the initial submission itself — polling for the
 * final result, and cleaning up afterwards.
 *
 * Reference: "Transaction Engine - Document Submission Protocol" (v2.0,
 * 15 August 2018).
 *
 * THE PROTOCOL IS ASYNCHRONOUS, NOT REQUEST/RESPONSE:
 *   1. POST a SUBMISSION_REQUEST to the submission endpoint.
 *   2. The Transaction Engine replies with a SUBMISSION_ACKNOWLEDGEMENT —
 *      NOT the final result. This contains a CorrelationID and a
 *      ResponseEndPoint (a DIFFERENT url from the one you submitted to),
 *      plus a PollInterval attribute saying how long to wait.
 *   3. Wait that long, then POST a SUBMISSION_POLL to that ResponseEndPoint.
 *   4. If HMRC's backend hasn't finished yet, you get ANOTHER
 *      acknowledgement — repeat step 3.
 *   5. Eventually you get a real SUBMISSION_RESPONSE (success) or a
 *      Business Error Response (failure) instead of an acknowledgement.
 *   6. You MUST then send a DELETE_REQUEST referencing the same
 *      CorrelationID, or HMRC's side just leaves the record sitting there
 *      for up to 60 days.
 *
 * Endpoints (confirmed from the protocol document):
 *   Test (ETS):  https://test-transaction-engine.tax.service.gov.uk/submission
 *   Live:        https://transaction-engine.tax.service.gov.uk/submission
 */

export const ETS_SUBMISSION_ENDPOINT = 'https://test-transaction-engine.tax.service.gov.uk/submission'
export const LIVE_SUBMISSION_ENDPOINT = 'https://transaction-engine.tax.service.gov.uk/submission'

export interface TransactionEngineError {
  number: number | null
  type: string
  text: string
  location: string | null
}

export interface ParsedGovTalkMessage {
  qualifier: 'acknowledgement' | 'response' | 'error' | 'poll' | 'request' | string
  correlationId: string | null
  responseEndpoint: string | null
  pollIntervalSeconds: number | null
  /** Present when qualifier is 'error' and the Body contains an ErrorResponse. */
  businessErrors: TransactionEngineError[]
  /** Raw body content, in case the caller needs something this parser doesn't extract. */
  rawBody: string | null
}

/** Posts XML to the Transaction Engine and returns the raw response text. */
export async function postToTransactionEngine(xml: string, url: string): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Transaction Engine returned HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  return text
}

/**
 * Parses any GovTalkMessage response from the Transaction Engine —
 * acknowledgement, final response, or business error — into a single
 * consistent shape.
 *
 * IMPORTANT: HMRC uses two different shapes for reporting errors,
 * confirmed by a real ETS response during testing:
 *   1. Early/fatal errors (e.g. authentication failure) — the error
 *      details sit directly in <GovTalkDetails><GovTalkErrors>, with an
 *      empty <Body/>. This is the SUBMISSION_ERROR message type.
 *   2. Business validation errors (the kind LTS returns) — sit nested
 *      inside <Body><ErrorResponse>, with a generic 3001 summary error
 *      also present in GovTalkErrors. This is the Business Error Response
 *      message type.
 * This function checks both locations and merges whatever it finds, so
 * neither error type goes unreported.
 */
export function parseGovTalkResponse(xml: string): ParsedGovTalkMessage {
  const qualifierMatch = xml.match(/<Qualifier>([^<]*)<\/Qualifier>/)
  const correlationIdMatch = xml.match(/<CorrelationID>([^<]*)<\/CorrelationID>/)
  const responseEndPointMatch = xml.match(/<ResponseEndPoint(?:\s+PollInterval="(\d+)")?\s*>([^<]*)<\/ResponseEndPoint>/)

  const bodyMatch = xml.match(/<Body>([\s\S]*?)<\/Body>/)
  const rawBody = bodyMatch ? bodyMatch[1].trim() : null

  const businessErrors: TransactionEngineError[] = []

  function extractErrorsFrom(sourceXml: string) {
    const errorBlocks = [...sourceXml.matchAll(/<Error>([\s\S]*?)<\/Error>/g)]
    for (const block of errorBlocks) {
      const errorXml = block[1]
      const numberMatch = errorXml.match(/<Number>(\d+)<\/Number>/)
      const typeMatch = errorXml.match(/<Type>([^<]*)<\/Type>/)
      const textMatch = errorXml.match(/<Text>([^<]*)<\/Text>/)
      const locationMatch = errorXml.match(/<Location>([^<]*)<\/Location>/)
      businessErrors.push({
        number: numberMatch ? parseInt(numberMatch[1], 10) : null,
        type: typeMatch ? typeMatch[1] : 'unknown',
        text: textMatch ? textMatch[1] : '',
        location: locationMatch ? locationMatch[1] : null,
      })
    }
  }

  // Check GovTalkDetails/GovTalkErrors first (fatal/early errors).
  const govTalkErrorsMatch = xml.match(/<GovTalkErrors>([\s\S]*?)<\/GovTalkErrors>/)
  if (govTalkErrorsMatch) extractErrorsFrom(govTalkErrorsMatch[1])

  // Then check inside Body (business validation errors) — skip the
  // generic 3001 "see below for details" summary already covered above
  // by only looking inside ErrorResponse specifically, not the whole body.
  if (rawBody) {
    const errorResponseMatch = rawBody.match(/<ErrorResponse[\s\S]*?>([\s\S]*)<\/ErrorResponse>/)
    if (errorResponseMatch) extractErrorsFrom(errorResponseMatch[1])
  }

  return {
    qualifier: (qualifierMatch ? qualifierMatch[1] : 'unknown') as ParsedGovTalkMessage['qualifier'],
    correlationId: correlationIdMatch && correlationIdMatch[1] ? correlationIdMatch[1] : null,
    responseEndpoint: responseEndPointMatch && responseEndPointMatch[2] ? responseEndPointMatch[2] : null,
    pollIntervalSeconds: responseEndPointMatch && responseEndPointMatch[1] ? parseInt(responseEndPointMatch[1], 10) : null,
    businessErrors,
    rawBody,
  }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Builds a SUBMISSION_POLL message — sent to the acknowledgement's ResponseEndPoint, not the original submission URL. */
export function buildPollMessage(classValue: string, correlationId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
<EnvelopeVersion>2.0</EnvelopeVersion>
<Header>
<MessageDetails>
<Class>${escapeXml(classValue)}</Class>
<Qualifier>poll</Qualifier>
<Function>submit</Function>
<CorrelationID>${escapeXml(correlationId)}</CorrelationID>
<Transformation>XML</Transformation>
</MessageDetails>
</Header>
<GovTalkDetails>
<Keys/>
</GovTalkDetails>
</GovTalkMessage>`
}

/** Builds a DELETE_REQUEST message — tells HMRC's side it can discard this submission's resources now that we have the final result. */
export function buildDeleteMessage(classValue: string, correlationId: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
<EnvelopeVersion>2.0</EnvelopeVersion>
<Header>
<MessageDetails>
<Class>${escapeXml(classValue)}</Class>
<Qualifier>request</Qualifier>
<Function>delete</Function>
<CorrelationID>${escapeXml(correlationId)}</CorrelationID>
<Transformation>XML</Transformation>
</MessageDetails>
<SenderDetails/>
</Header>
<GovTalkDetails>
<Keys/>
</GovTalkDetails>
<Body/>
</GovTalkMessage>`
}
