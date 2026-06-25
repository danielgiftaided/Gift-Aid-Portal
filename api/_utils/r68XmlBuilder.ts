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
 * CREDENTIALS MODEL (confirmed): submissions use Gift Aided's own single
 * Government Gateway login — not each charity's individual credentials.
 * One shared SenderID/password covers every charity, with HMRC matching
 * the submission to the correct charity via <HMRCref>/<CHARID> plus the
 * Agent/Nominee reference in <AgtOrNom>. This means credentials never need
 * to be collected from or shared by charities themselves.
 *
 * Worth confirming with SDST if not already done: whether each individual
 * charity needs to separately authorise Gift Aided as their agent through
 * HMRC's standard agent-authorisation process before a submission using
 * Gift Aided's Gateway login plus that charity's reference will actually
 * be accepted — this is a different step from collecting the Agent/Nominee
 * reference number itself.
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
  donationDate: string   // ccyy-mm-dd — confirmed mandatory by LTS validation, positioned right after donor/sponsored
  aggregated?: boolean   // true if this row represents aggregated small donations (<=£20 each, max £1000/line) — UNVERIFIED position, see note in buildGadElement
  aggregatedDescription?: string
  sponsoredEvent?: boolean
  amount: number         // always 2dp; if <£10 still needs a leading zero e.g. 9.99
}

export interface GiftAidClaimInput {
  charityHmrcReference: string   // e.g. "AB12345" — the charity's own HMRC Charities reference
  agentOrNomineeReference: string // required — must match enrolment exactly (error 7020 otherwise)
  claimingOrganisationName: string
  taxYear: string                 // for our own reference; not itself an R68 field, used to derive PeriodEnd
  donations: GiftAidDonor[]
  adjustment?: { amount: number; explanation: string }
  // Confirmed conditionally mandatory by business rule 7029: required
  // whenever the charity's HMRC reference doesn't start with CH or CF and
  // no Collecting Agent is involved. Defaults to CCEW (England & Wales)
  // since that covers most charities — NOT yet configurable per charity,
  // so Scottish (OSCR) or Northern Irish (CCNI) charities will need this
  // overridden before a real submission for them specifically.
  regulatorName?: 'CCEW' | 'CCNI' | 'OSCR'
  // Confirmed mandatory (business rule 7031) whenever regulatorName/RegName
  // is present — this is the charity's actual Charity Commission (or OSCR/
  // CCNI) registration number, which is a DIFFERENT number from the HMRC
  // Gift Aid reference (charityHmrcReference) above.
  regulatorNumber?: string
}

export interface SubmissionCredentials {
  vendorId: string        // 4-digit, e.g. "9330"
  productName: string
  productVersion: string
  senderId: string        // Government Gateway User ID — see OPEN QUESTION above
  senderPassword: string  // Government Gateway password — see OPEN QUESTION above
  isLive: boolean          // false => GatewayTest=1, true => omit GatewayTest
  // Gift Aided's OWN details as the submitting agent — confirmed required by
  // the real R68 schema's AgtOrNom structure (NOT the charity's details).
  agentOrgName: string     // e.g. "Gift Aided Ltd"
  agentPostcode: string    // Gift Aided's own registered postcode — must match r68_PostCodeType format
  agentPhone: string       // Gift Aided's own contact phone number
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
  // Confirmed order by LTS schema validation: Donor -> [Sponsored] -> Date -> Total
  if (d.sponsoredEvent) inner.push(`<Sponsored>yes</Sponsored>`)
  inner.push(`<Date>${d.donationDate}</Date>`)
  inner.push(`<Total>${formatAmount(d.amount)}</Total>`)
  // NOTE: aggregated-donation handling removed here pending schema
  // verification — LTS only told us about the Sponsored/Date/Total
  // sequence since none of our real test data used aggregation yet.
  // Do not re-add <AggregatedDonations> without checking its real
  // position against the actual XSD first.
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

  // EarliestGAdate is confirmed conditionally mandatory by business rule
  // 7034 whenever any GAD entries are present. donationDate strings are
  // already ccyy-mm-dd, so a plain string min() sorts correctly.
  const earliestDonationDate = claim.donations
    .map(d => d.donationDate)
    .reduce((earliest, current) => (current < earliest ? current : earliest))

  // Adjustment sits INSIDE <Repayment>, after the GAD entries — confirmed
  // by the real schema. The explanation (if any) goes in the separate,
  // Claim-level <OtherInfo> free-text field, not bundled with Adjustment.
  const adjustmentElement = claim.adjustment
    ? `<Adjustment>${formatAmount(claim.adjustment.amount)}</Adjustment>`
    : ''
  const otherInfoElement = claim.adjustment?.explanation
    ? `<OtherInfo>${escapeXml(claim.adjustment.explanation.slice(0, 350))}</OtherInfo>`
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
<AgtOrNom>
<OrgName>${escapeXml(credentials.agentOrgName)}</OrgName>
<RefNo>${escapeXml(claim.agentOrNomineeReference)}</RefNo>
<AoNID>
<Postcode>${escapeXml(credentials.agentPostcode)}</Postcode>
</AoNID>
<Phone>${escapeXml(credentials.agentPhone)}</Phone>
</AgtOrNom>
<Declaration>yes</Declaration>
<Claim>
<OrgName>${escapeXml(claim.claimingOrganisationName)}</OrgName>
<HMRCref>${escapeXml(claim.charityHmrcReference)}</HMRCref>
<Regulator>
<RegName>${escapeXml(claim.regulatorName || 'CCEW')}</RegName>
<RegNo>${escapeXml(claim.regulatorNumber || '')}</RegNo>
</Regulator>
<Repayment>
${gadElements}
<EarliestGAdate>${earliestDonationDate}</EarliestGAdate>
${adjustmentElement}
</Repayment>
${otherInfoElement}
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
