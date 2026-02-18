import { validateR68Claim, ValidationError } from './hmrc-validation'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface CharityDetails {
  regulatorCode: 'CCEW' | 'CCNI' | 'OSCR' // England/Wales, N.Ireland, Scotland
  charityNumber: string
  charityHMRCRef: string
  charityName: string
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
  donationDate: string // YYYY-MM-DD
  declarationDate: string // YYYY-MM-DD
  amount: number
  sponsored: boolean
  aggregated: boolean
}

export interface R68Claim {
  charity: CharityDetails
  donations: GiftAidDonation[]
  taxYear: string
  adjustment: boolean
  adjustmentAmount?: number
  otherIncome: number
  claimPeriodStart: string // YYYY-MM-DD
  claimPeriodEnd: string // YYYY-MM-DD
}

export interface XMLGenerationOptions {
  isTest?: boolean
  includeComments?: boolean
  vendorPassword?: string
}

// ============================================================================
// MAIN XML GENERATION FUNCTION
// ============================================================================

export function generateR68XML(
  claim: R68Claim, 
  options: XMLGenerationOptions = {}
): string {
  const { 
    isTest = true, 
    includeComments = false,
    vendorPassword = process.env.VITE_HMRC_TEST_PASSWORD || ''
  } = options

  // Validate the claim before generating XML
  try {
    validateR68Claim(claim)
  } catch (error) {
    if (error instanceof ValidationError) {
      throw new Error(`Validation failed: ${error.message}`)
    }
    throw error
  }

  // Generate unique identifiers
  const transactionID = generateTransactionID()
  const correlationID = transactionID // Same as transaction ID for new submissions
  const timestamp = new Date().toISOString()

  // Calculate totals
  const totalDonations = claim.donations.reduce((sum, d) => sum + d.amount, 0)
  const totalGiftAid = calculateTotalGiftAid(totalDonations)

  // Build the XML
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GovTalkMessage xmlns="http://www.govtalk.gov.uk/CM/envelope">
  <EnvelopeVersion>2.0</EnvelopeVersion>
  <Header>
    <MessageDetails>
      <Class>HMRC-CHAR-CLM</Class>
      <Qualifier>request</Qualifier>
      <Function>submit</Function>
      <TransactionID>${transactionID}</TransactionID>
      <CorrelationID>${correlationID}</CorrelationID>
      <Transformation>XML</Transformation>
      <GatewayTimestamp>${timestamp}</GatewayTimestamp>
      <GatewayTest>${isTest ? '1' : '0'}</GatewayTest>
    </MessageDetails>
    <SenderDetails>
      <IDAuthentication>
        <SenderID>9330</SenderID>${includeComments ? ' <!-- Your Vendor ID -->' : ''}
        <Authentication>
          <Method>clear</Method>
          <Value>${escapeXML(vendorPassword)}</Value>
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
    ${generateR68Body(claim, includeComments)}
  </Body>
</GovTalkMessage>`

  return xml
}

// ============================================================================
// R68 BODY GENERATION
// ============================================================================

function generateR68Body(claim: R68Claim, includeComments: boolean): string {
  const totalDonations = claim.donations.reduce((sum, d) => sum + d.amount, 0)
  const totalGiftAid = calculateTotalGiftAid(totalDonations)

  return `<R68>
      <AuthOfficeAddress>
        <Line1>Charities, Savings and International</Line1>
        <Line2>HM Revenue and Customs</Line2>
        <Line3>BX9 1AU</Line3>
      </AuthOfficeAddress>
      <Claim>
        <Repayment>
          ${generateGADSection(claim, includeComments)}
          ${generateGASDSSection(claim.donations, includeComments)}
        </Repayment>
        <Adjustment>${claim.adjustment ? 'yes' : 'no'}</Adjustment>${claim.adjustment && claim.adjustmentAmount ? `
        <AdjustmentAmount>${claim.adjustmentAmount.toFixed(2)}</AdjustmentAmount>` : ''}
        <OtherInc>
          <OtherIncAmt>${claim.otherIncome.toFixed(2)}</OtherIncAmt>
        </OtherInc>
      </Claim>
      <ClaimPeriod>
        <Start>${claim.claimPeriodStart}</Start>
        <End>${claim.claimPeriodEnd}</End>
      </ClaimPeriod>
    </R68>`
}

// ============================================================================
// GAD SECTION (Charity Details)
// ============================================================================

function generateGADSection(claim: R68Claim, includeComments: boolean): string {
  return `<GAD>${includeComments ? ' <!-- Gift Aid Details -->' : ''}
            <ConnectedCharities>${claim.charity.connectedCharities ? 'yes' : 'no'}</ConnectedCharities>
            <CommBldgs>${claim.charity.communityBuildings ? 'yes' : 'no'}</CommBldgs>
            <Regulator>${claim.charity.regulatorCode}</Regulator>${includeComments ? ` <!-- ${getRegulatorName(claim.charity.regulatorCode)} -->` : ''}
            <RegulatedCharityNumber>${claim.charity.charityNumber}</RegulatedCharityNumber>
            <HMRCref>${claim.charity.charityHMRCRef}</HMRCref>
            <CharityName>${escapeXML(claim.charity.charityName)}</CharityName>
          </GAD>`
}

// ============================================================================
// GASDS SECTION (Donations)
// ============================================================================

function generateGASDSSection(donations: GiftAidDonation[], includeComments: boolean): string {
  return `<GASDS>${includeComments ? ' <!-- Gift Aid Small Donations Scheme -->' : ''}
            <GASDs>
              ${donations.map((donation, index) => generateGASDEntry(donation, index, includeComments)).join('\n              ')}
            </GASDs>
          </GASDS>`
}

function generateGASDEntry(donation: GiftAidDonation, index: number, includeComments: boolean): string {
  const giftAidAmount = calculateGiftAid(donation.amount)
  
  return `<GASD>${includeComments ? ` <!-- Donation ${index + 1} -->` : ''}
                <Donor>
                  ${donation.donor.title ? `<Ttl>${escapeXML(donation.donor.title)}</Ttl>` : ''}
                  <Fore>${escapeXML(donation.donor.forename)}</Fore>
                  <Sur>${escapeXML(donation.donor.surname)}</Sur>
                  <House>${escapeXML(donation.donor.houseNameNumber)}</House>
                  <Postcode>${formatPostcode(donation.donor.postcode)}</Postcode>
                </Donor>
                <Date>${donation.donationDate}</Date>
                <Total>${donation.amount.toFixed(2)}</Total>
                <Sponsored>${donation.sponsored ? 'yes' : 'no'}</Sponsored>
                <Aggregated>${donation.aggregated ? 'yes' : 'no'}</Aggregated>${includeComments ? `
                <!-- Gift Aid Amount: £${giftAidAmount.toFixed(2)} -->` : ''}
              </GASD>`
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a unique transaction ID
 */
function generateTransactionID(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8).toUpperCase()
  return `GIFTAIDED-${timestamp}-${random}`
}

/**
 * Escape XML special characters
 */
function escapeXML(str: string): string {
  if (!str) return ''
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format postcode to standard UK format (uppercase, space in correct position)
 */
function formatPostcode(postcode: string): string {
  // Remove all spaces and convert to uppercase
  const cleaned = postcode.replace(/\s/g, '').toUpperCase()
  
  // Insert space before last 3 characters
  if (cleaned.length >= 5) {
    return cleaned.slice(0, -3) + ' ' + cleaned.slice(-3)
  }
  
  return cleaned
}

/**
 * Calculate Gift Aid amount for a donation
 * Gift Aid is 25p for every £1 donated (based on 20% basic rate tax)
 */
export function calculateGiftAid(donationAmount: number): number {
  return donationAmount * 0.25
}

/**
 * Calculate total Gift Aid for all donations
 */
export function calculateTotalGiftAid(totalDonations: number): number {
  return totalDonations * 0.25
}

/**
 * Get regulator full name
 */
function getRegulatorName(code: string): string {
  switch (code) {
    case 'CCEW':
      return 'Charity Commission for England and Wales'
    case 'OSCR':
      return 'Office of the Scottish Charity Regulator'
    case 'CCNI':
      return 'Charity Commission for Northern Ireland'
    default:
      return 'Unknown Regulator'
  }
}

// ============================================================================
// HELPER FUNCTIONS FOR CREATING CLAIMS
// ============================================================================

/**
 * Helper to create a claim from donation data
 */
export function createR68Claim(
  charity: CharityDetails,
  donations: GiftAidDonation[],
  taxYear: string,
  options: {
    adjustment?: boolean
    adjustmentAmount?: number
    otherIncome?: number
  } = {}
): R68Claim {
  // Determine claim period from donations
  const dates = donations.map(d => new Date(d.donationDate))
  const earliestDate = new Date(Math.min(...dates.map(d => d.getTime())))
  const latestDate = new Date(Math.max(...dates.map(d => d.getTime())))

  return {
    charity,
    donations,
    taxYear,
    adjustment: options.adjustment || false,
    adjustmentAmount: options.adjustmentAmount || 0,
    otherIncome: options.otherIncome || 0,
    claimPeriodStart: earliestDate.toISOString().split('T')[0],
    claimPeriodEnd: latestDate.toISOString().split('T')[0]
  }
}

/**
 * Helper to create a test claim with sample data
 */
export function createTestClaim(): R68Claim {
  const charity: CharityDetails = {
    regulatorCode: 'CCEW',
    charityNumber: '1234567',
    charityHMRCRef: 'A1234B',
    charityName: 'Test Charity Foundation',
    connectedCharities: false,
    communityBuildings: false
  }

  const donations: GiftAidDonation[] = [
    {
      donor: {
        title: 'Mr',
        forename: 'John',
        surname: 'Smith',
        houseNameNumber: '10',
        postcode: 'SW1A 1AA'
      },
      donationDate: '2024-05-15',
      declarationDate: '2024-05-15',
      amount: 100.00,
      sponsored: false,
      aggregated: false
    },
    {
      donor: {
        title: 'Mrs',
        forename: 'Jane',
        surname: 'Doe',
        houseNameNumber: '25',
        postcode: 'M1 1AA'
      },
      donationDate: '2024-06-20',
      declarationDate: '2024-06-15',
      amount: 250.00,
      sponsored: false,
      aggregated: false
    },
    {
      donor: {
        forename: 'Robert',
        surname: "O'Brien",
        houseNameNumber: 'Flat 3B',
        postcode: 'EH1 2NG'
      },
      donationDate: '2024-07-10',
      declarationDate: '2024-07-10',
      amount: 50.00,
      sponsored: false,
      aggregated: false
    }
  ]

  return createR68Claim(charity, donations, '2024-25', {
    adjustment: false,
    otherIncome: 0
  })
}

/**
 * Save XML to file (for browser download)
 */
export function downloadXML(xml: string, filename?: string): void {
  const blob = new Blob([xml], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename || `r68-claim-${Date.now()}.xml`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Validate and generate XML in one step
 */
export function validateAndGenerateXML(
  claim: R68Claim,
  options: XMLGenerationOptions = {}
): { success: boolean; xml?: string; errors?: string[] } {
  try {
    const xml = generateR68XML(claim, options)
    return { success: true, xml }
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error occurred']
    }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  generateR68XML,
  createR68Claim,
  createTestClaim,
  calculateGiftAid,
  calculateTotalGiftAid,
  downloadXML,
  validateAndGenerateXML
}
