/**
 * Builds the GovTalkMessage XML envelope for a single-charity Gift Aid
 * repayment claim (R68), per:
 *   - Charities Technical Pack v1.3
 *   - Charities Online Non-Form Validation Rules v1.3
 *   - Charities Online Service: Additional Guidance for Software Developers v1.1
 *
 * This builds a SINGLE CHARITY claim using message class HMRC-CHAR-CLM —
 * NOT HMRC-CHAR-CLM-MULTI, which is reserved for HMRC-authorised
 * "Collection Agents" submitting composite claims spanning multiple
 * charities in one envelope. A normal registered agent submitting on
 * behalf of one charity at a time should always use HMRC-CHAR-CLM with the
 * CHARID key, plus their own Agent/Nominee reference in <AgtOrNom>.
 *
 * OPEN QUESTION (flagged, not yet resolved): whose Gateway credentials
 * populate <SenderID>/<Value> below — the charity's own enrolled Gateway
 * login, or an agent-specific identity tied to the Vendor ID and Agent
 * reference. Until this is confirmed with HMRC's Software Developers
 * Support Team, `credentials` below is deliberately just "whatever
 * SenderID/password we're told to use" rather than baking in an assumption.
 *
 * IMPORTANT: this builder produces the XML with a placeholder empty
 * <IRmark> element. The real IRmark must be computed (see irmark.ts) from
 * THIS EXACT STRING before submission, then spliced back in. Do not
 * regenerate or reformat the XML after computing the IRmark — any
 * whitespace difference will produce a mismatch (HMRC error 2021).
 */

export interface GiftAidDonor {
  title?: string        // 1-4 chars, upper/lower alpha + backslash/hyphen only
  firstName: string
  lastName: string
  houseNameOrNumber: string
  postcode?: string      // required for UK residents
  overseas?: boolean     // set true for non-UK residents (then postcode omitted, full address in house field)
  aggregated?: boolean   // true if this row represents aggregated small donations (<=£20 each, max £1000/line)
  aggregatedDescription?: string
  sponsoredEvent?: boolean
  amount: number         // always 2dp; if <£10 still needs a leading zero e.g. 9.99
}

export interface GiftAidClaimInput {
  charityHmrcReference: string   // e.g. "AB12345" — the charity's own HMRC Charities reference
  agentOrNomineeReference?: string // required if submitting as Agent/Nominee — must match enrolment exactly (error 7020 otherwise)
  claimingOrganisationName: string
  authorisedOfficialName: string
  taxYear: string                 // for our own reference; not itself an R68 field, used to derive PeriodEnd
  donations: GiftAidDonor[]
  adjustment?: { amount: number; explanation: string }
}

export interface SubmissionCredentials {
  vendorId: string        // 4-digit, e.g. "9330"
  productName: string
  productVersion: string
  senderId: string        // Government Gateway User ID — see OPEN QUESTION above
  senderPassword: string  // Government Gateway password — see OPEN QUESTION above
  isLive: boolean          // false => GatewayTest=1, true => omit GatewayTest
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatAmount(amount: number): string {
  // Always 2 decimal places; values under £10 still need the leading zero,
  // e.g. 0.02, 9.99 — toFixed(2) already satisfies this.
  return amount.toFixed(2)
}

function buildDonorElement(d: GiftAidDonor): string {
  const parts: string[] = []
  if (d.title) parts.push(`<Ttl>${escapeXml(d.title)}</Ttl>`)
  parts.push(`<Fore>${escapeXml(d.firstName)}</Fore>`)
  parts.push(`<Sur>${escapeXml(d.lastName)}</Sur>`)
  parts.push(`<House>${escapeXml(d.houseNameOrNumber)}</House>`)
  if (d.overseas) {
    parts.push(`<Overseas>yes</Overseas>`)
  } else if (d.postcode) {
    parts.push(`<Postcode>${escapeXml(d.postcode)}</Postcode>`)
  }
  return `<Donor>${parts.join('')}</Donor>`
}

function buildGadElement(d: GiftAidDonor): string {
  const inner: string[] = [buildDonorElement(d)]
  if (d.sponsoredEvent) inner.push(`<SponsoredEventInd>yes</SponsoredEventInd>`)
  if (d.aggregated) {
    inner.push(`<AggregatedDonations>${escapeXml(d.aggregatedDescription || '')}</AggregatedDonations>`)
  }
  inner.push(`<Total>${formatAmount(d.amount)}</Total>`)
  return `<GAD>${inner.join('')}</GAD>`
}

/**
 * Builds the full GovTalkMessage XML for a single-charity claim, with an
 * empty <IRmark/> placeholder ready to be filled in by irmark.ts.
 */
export function buildR68Submission(
  claim: GiftAidClaimInput,
  credentials: SubmissionCredentials
): string {
  const gadElements = claim.donations.map(buildGadElement).join('')

  const agtOrNom = claim.agentOrNomineeReference
    ? `<AgtOrNom><RefNo>${escapeXml(claim.agentOrNomineeReference)}</RefNo></AgtOrNom>`
    : ''

  const adjustment = claim.adjustment
    ? `<Adjustment>${formatAmount(claim.adjustment.amount)}</Adjustment><OtherInformation>${escapeXml(claim.adjustment.explanation)}</OtherInformation>`
    : ''

  const gatewayTestElement = credentials.isLive ? '' : `<GatewayTest>1</GatewayTest>`

  // NOTE: PeriodEnd is required by schema but not used for Charities Online
  // claims — populate with a schema-valid date derived from the tax year.
  const periodEndDate = deriveTaxYearEndDate(claim.taxYear)

  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
<EnvelopeVersion>2.0</EnvelopeVersion>
<Header>
<MessageDetails>
<Class>HMRC-CHAR-CLM</Class>
<Qualifier>request</Qualifier>
<Function>submit</Function>
${gatewayTestElement}
<GatewayTimestamp></GatewayTimestamp>
</MessageDetails>
<SenderDetails>
<IDAuthentication>
<SenderID>${escapeXml(credentials.senderId)}</SenderID>
<Authentication>
<Method>clear</Method>
<Role>principal</Role>
<Value>${escapeXml(credentials.senderPassword)}</Value>
</Authentication>
</IDAuthentication>
</SenderDetails>
</Header>
<GovTalkDetails>
<Keys>
<Key Type="CHARID">${escapeXml(claim.charityHmrcReference)}</Key>
</Keys>
<TargetDetails>
<Organisation>HMRC</Organisation>
</TargetDetails>
<ChannelRouting>
<Channel>
<URI>${escapeXml(credentials.vendorId)}</URI>
<Product>${escapeXml(credentials.productName)}</Product>
<Version>${escapeXml(credentials.productVersion)}</Version>
</Channel>
</ChannelRouting>
</GovTalkDetails>
<Body>
<IRenvelope xmlns="http://www.govtalk.gov.uk/taxation/charities/r68/2">
<IRheader>
<Keys>
<Key Type="CHARID">${escapeXml(claim.charityHmrcReference)}</Key>
</Keys>
<PeriodEnd>${periodEndDate}</PeriodEnd>
<DefaultCurrency>GBP</DefaultCurrency>
<IRmark Type="generic"></IRmark>
<Sender>Agent</Sender>
</IRheader>
<R68>
<Claim>
<OrgName>${escapeXml(claim.claimingOrganisationName)}</OrgName>
<HMRCref>${escapeXml(claim.charityHmrcReference)}</HMRCref>
<OffName>${escapeXml(claim.authorisedOfficialName)}</OffName>
${agtOrNom}
<Repayment>
${gadElements}
</Repayment>
${adjustment}
</Claim>
</R68>
</IRenvelope>
</Body>
</GovTalkMessage>`
}

/** Derives a schema-valid PeriodEnd date (ccyy-mm-dd) from a "YYYY/YY" UK tax year string. */
function deriveTaxYearEndDate(taxYear: string): string {
  const startYearMatch = taxYear.match(/^(\d{4})/)
  const startYear = startYearMatch ? parseInt(startYearMatch[1], 10) : new Date().getFullYear()
  return `${startYear + 1}-04-05`
}
