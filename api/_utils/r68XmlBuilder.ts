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
  firstName?: string    // not required when aggregated is true (AggDonation has no name)
  lastName?: string     // not required when aggregated is true
  houseNameOrNumber?: string  // not required when aggregated is true
  postcode?: string      // required for UK residents; omit for overseas or aggregated
  overseas?: boolean     // set true for non-UK residents (then postcode omitted, full address in house field)
  donationDate: string   // ccyy-mm-dd — confirmed mandatory by LTS validation
  aggregated?: boolean   // true when this row represents aggregated small donations (<=£20 each,
                         // max £1000/line, max £1000 per claim) — uses <AggDonation> instead of <Donor>
  aggregatedDescription?: string  // mandatory when aggregated is true — free text up to 35 chars
                                  // e.g. "200 x £5 payments from members"
  sponsoredEvent?: boolean
  amount: number         // always 2dp; if <£10 still needs a leading zero e.g. 9.99
}

/**
 * Other income received under Gift Aid (e.g. a covenanted payment with tax
 * deducted at source) — sits inside <Repayment> after all GAD entries.
 * Different from regular Gift Aid donations: has a named payer, gross amount,
 * and the tax already deducted, rather than a donation amount and declaration.
 */
export interface OtherIncome {
  payer: string          // name of the payer — up to 40 chars
  date: string           // ccyy-mm-dd
  grossAmount: number    // gross income received — always 2dp
  taxDeducted: number    // tax deducted at source — always 2dp
}

export interface GiftAidClaimInput {
  charityHmrcReference: string
  agentOrNomineeReference: string
  claimingOrganisationName: string
  taxYear: string
  donations: GiftAidDonor[]
  otherIncome?: OtherIncome[]  // sits inside <Repayment> after GAD entries, before <Adjustment>
  adjustment?: { amount: number; explanation: string }
  regulatorName?: 'CCEW' | 'CCNI' | 'OSCR'
  regulatorNumber?: string
  gasds?: GasdsClaimInput
}

export interface GasdsClaimInput {
  claimYear: number
  amount: number
  connectedCharities: boolean
  communityBuildings: boolean
  adjustment?: number  // <Adj> inside <GASDS> — separate from the Gift Aid <Adjustment>
                       // inside <Repayment>. Confirmed by the real schema as the last
                       // optional child of <GASDS>, after <Building> entries.
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
  const inner: string[] = []

  // The real schema defines GAD as a choice between <Donor> (named individual)
  // and <AggDonation> (a short description string for small aggregated donations
  // where individual names are not collected). These are mutually exclusive —
  // never both in the same GAD entry. AggDonation max 35 chars per schema.
  if (d.aggregated) {
    const desc = (d.aggregatedDescription || '').slice(0, 35)
    inner.push(`<AggDonation>${escapeXml(desc)}</AggDonation>`)
  } else {
    inner.push(buildDonorElement(d as Required<Pick<GiftAidDonor, 'firstName' | 'lastName' | 'houseNameOrNumber'>> & GiftAidDonor))
  }

  // Confirmed order by LTS schema validation: [Donor|AggDonation] -> [Sponsored] -> Date -> Total
  if (d.sponsoredEvent) inner.push(`<Sponsored>yes</Sponsored>`)
  inner.push(`<Date>${d.donationDate}</Date>`)
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

  // EarliestGAdate is confirmed conditionally mandatory by business rule
  // 7034 whenever any GAD entries are present. donationDate strings are
  // already ccyy-mm-dd, so a plain string min() sorts correctly.
  //
  // The real schema marks <Repayment> itself as OPTIONAL — a charity can
  // legitimately submit a GASDS-only claim with zero individual donors at
  // all (e.g. bucket collections only, no named Gift Aid declarations).
  // .reduce() with no seed throws on an empty array, so this must be
  // guarded explicitly rather than assumed donations.length > 0.
  const hasDonations = claim.donations.length > 0
  const earliestDonationDate = hasDonations
    ? claim.donations.map(d => d.donationDate).reduce((earliest, current) => (current < earliest ? current : earliest))
    : null

  // Adjustment sits INSIDE <Repayment>, after OtherInc entries — confirmed
  // by the real schema order: GAD..., EarliestGAdate, OtherInc..., Adjustment.
  // The explanation (if any) goes in the separate Claim-level <OtherInfo>.
  const adjustmentElement = claim.adjustment
    ? `<Adjustment>${formatAmount(claim.adjustment.amount)}</Adjustment>`
    : ''
  const otherInfoElement = claim.adjustment?.explanation
    ? `<OtherInfo>${escapeXml(claim.adjustment.explanation.slice(0, 350))}</OtherInfo>`
    : ''

  // OtherInc entries sit inside <Repayment> after all GAD entries and
  // EarliestGAdate, before <Adjustment> — per the real R68 schema order.
  // Each entry represents other income received under Gift Aid (e.g. a
  // covenanted payment with tax already deducted at source).
  const otherIncElements = (claim.otherIncome || []).map(oi =>
    `<OtherInc><Payer>${escapeXml(oi.payer.slice(0, 40))}</Payer><OIDate>${oi.date}</OIDate><Gross>${formatAmount(oi.grossAmount)}</Gross><Tax>${formatAmount(oi.taxDeducted)}</Tax></OtherInc>`
  ).join('')

  // GASDS sits as its own block at the Claim level, a SIBLING of
  // <Repayment> — schema order: OrgName, HMRCref, Regulator, Repayment,
  // GASDS, OtherInfo. <Adj> (GASDS adjustment) is the last optional child
  // of <GASDS>, separate from <Adjustment> inside <Repayment>.
  const gasdsElement = claim.gasds
    ? `<GASDS><ConnectedCharities>${claim.gasds.connectedCharities ? 'yes' : 'no'}</ConnectedCharities><GASDSClaim><Year>${claim.gasds.claimYear}</Year><Amount>${formatAmount(claim.gasds.amount)}</Amount></GASDSClaim><CommBldgs>${claim.gasds.communityBuildings ? 'yes' : 'no'}</CommBldgs>${claim.gasds.adjustment != null ? `<Adj>${formatAmount(claim.gasds.adjustment)}</Adj>` : ''}</GASDS>`
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
${hasDonations ? `<Repayment>
${gadElements}
<EarliestGAdate>${earliestDonationDate}</EarliestGAdate>
${otherIncElements}
${adjustmentElement}
</Repayment>` : ''}
${gasdsElement}
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
