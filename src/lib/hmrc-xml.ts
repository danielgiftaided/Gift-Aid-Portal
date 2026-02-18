export interface CharityDetails {
  regulatorCode: 'CCEW' | 'CCNI' | 'OSCR' // England/Wales, N.Ireland, Scotland
  charityNumber: string
  charityHMRCRef: string
  connectedCharities: boolean
  communityBuildings: boolean
}

export interface Donor {
  title?: string
  forename: string
  surname: string
  houseNameNumber: string
  postcode: string
}

export interface GiftAidDonation {
  donor: Donor
  date: string // YYYY-MM-DD
  amount: number
  sponsored: boolean
  aggregated: boolean
}

export interface R68Claim {
  charity: CharityDetails
  donations: GiftAidDonation[]
  taxYear: string
  adjustment: boolean
  otherIncome: number
}

export function generateR68XML(claim: R68Claim, isTest: boolean = true): string {
  const transactionID = generateTransactionID()
  const timestamp = new Date().toISOString()
  const totalClaim = claim.donations.reduce((sum, d) => sum + d.amount, 0)

  return `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CHAR-CLM</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <TransactionID>${transactionID}</TransactionID>
      <CorrelationID>${transactionID}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTimestamp>${timestamp}</GatewayTimestamp>
      <GatewayTest>${isTest ? '1' : '0'}</GatewayTest>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>9330</SenderID>
        <Authentication>
          <Method>clear</Method>
          <Value>${process.env.HMRC_TEST_PASSWORD || ''}</Value>
        </Authentication>
      </IDAuthentication>
    </SenderDetails>
  </Header>
  <GovTalkDetails>
    <Keys>
      <Key Type="VendorID">9330</Key>
    </Keys>
  </GovTalkDetails>
  <Body>
    <R68>
      <AuthOfficeAddress>
        <Line1>Charities, Savings and International</Line1>
        <Line2>HM Revenue and Customs</Line2>
        <Line3>BX9 1AU</Line3>
      </AuthOfficeAddress>
      <Claim>
        <Repayment>
          <GAD>
            <ConnectedCharities>${claim.charity.connectedCharities ? 'yes' : 'no'}</ConnectedCharities>
            <CommBldgs>${claim.charity.communityBuildings ? 'yes' : 'no'}</CommBldgs>
            <Regulator>${claim.charity.regulatorCode}</Regulator>
            <RegulatedCharityNumber>${claim.charity.charityNumber}</RegulatedCharityNumber>
          </GAD>
          <GASDS>
            <GASDs>
              ${claim.donations.map(donation => `
              <GASD>
                <Donor>
                  ${donation.donor.title ? `<Ttl>${escapeXML(donation.donor.title)}</Ttl>` : ''}
                  <Fore>${escapeXML(donation.donor.forename)}</Fore>
                  <Sur>${escapeXML(donation.donor.surname)}</Sur>
                  <House>${escapeXML(donation.donor.houseNameNumber)}</House>
                  <Postcode>${donation.donor.postcode}</Postcode>
                </Donor>
                <Date>${donation.date}</Date>
                <Total>${donation.amount.toFixed(2)}</Total>
                <Sponsored>${donation.sponsored ? 'yes' : 'no'}</Sponsored>
                <Aggregated>${donation.aggregated ? 'yes' : 'no'}</Aggregated>
              </GASD>
              `).join('')}
            </GASDs>
          </GASDS>
        </Repayment>
        <Adjustment>${claim.adjustment ? 'yes' : 'no'}</Adjustment>
        <OtherInc>
          <OtherIncAmt>${claim.otherIncome.toFixed(2)}</OtherIncAmt>
        </OtherInc>
      </Claim>
    </R68>
  </Body>
</GovTalkMessage>`
}

function generateTransactionID(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `GIFTAIDED-${timestamp}-${random}`
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Helper to calculate Gift Aid amount
export function calculateGiftAid(donationAmount: number): number {
  // Gift Aid is 25% of donation (basic rate 20% grossed up)
  return donationAmount * 0.25
}
