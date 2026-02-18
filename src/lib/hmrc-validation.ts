export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// Validate UK postcode format
export function validatePostcode(postcode: string): boolean {
  const postcodeRegex = /^[A-Z]{1,2}[0-9R][0-9A-Z]?\s?[0-9][A-Z]{2}$/i
  return postcodeRegex.test(postcode.trim())
}

// Validate HMRC reference format (e.g., A1234B)
export function validateHMRCReference(ref: string): boolean {
  const hmrcRefRegex = /^[A-Z]\d{4}[A-Z]$/
  return hmrcRefRegex.test(ref)
}

// Validate charity number based on regulator
export function validateCharityNumber(number: string, regulator: string): boolean {
  switch (regulator) {
    case 'CCEW': // England & Wales
      return /^\d{6,7}$/.test(number)
    case 'OSCR': // Scotland
      return /^SC\d{6}$/.test(number)
    case 'CCNI': // Northern Ireland
      return /^NIC\d{6}$/.test(number)
    default:
      return false
  }
}

// Validate donation amount
export function validateAmount(amount: number): void {
  if (amount < 1) {
    throw new ValidationError('Donation amount must be at least £1.00')
  }
  if (amount > 999999.99) {
    throw new ValidationError('Donation amount cannot exceed £999,999.99')
  }
  if (!/^\d+\.\d{2}$/.test(amount.toFixed(2))) {
    throw new ValidationError('Amount must have exactly 2 decimal places')
  }
}

// Validate name format
export function validateName(name: string, fieldName: string): void {
  if (!name || name.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required`)
  }
  if (name.length > 35) {
    throw new ValidationError(`${fieldName} must be 35 characters or less`)
  }
  if (!/^[a-zA-Z\s'-]+$/.test(name)) {
    throw new ValidationError(`${fieldName} can only contain letters, spaces, hyphens, and apostrophes`)
  }
}

// Validate date format and logic
export function validateDonationDate(donationDate: string, declarationDate: string): void {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  
  if (!dateRegex.test(donationDate)) {
    throw new ValidationError('Donation date must be in YYYY-MM-DD format')
  }
  if (!dateRegex.test(declarationDate)) {
    throw new ValidationError('Declaration date must be in YYYY-MM-DD format')
  }

  const donation = new Date(donationDate)
  const declaration = new Date(declarationDate)
  const today = new Date()

  if (donation > today) {
    throw new ValidationError('Donation date cannot be in the future')
  }

  if (declaration > donation) {
    throw new ValidationError('Declaration date must be on or before donation date')
  }

  // Check declaration is within last 4 tax years
  const fourYearsAgo = new Date()
  fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4)
  
  if (declaration < fourYearsAgo) {
    throw new ValidationError('Declaration date must be within the last 4 tax years')
  }
}

// Validate tax year format
export function validateTaxYear(taxYear: string): void {
  const taxYearRegex = /^\d{4}-\d{2}$/
  
  if (!taxYearRegex.test(taxYear)) {
    throw new ValidationError('Tax year must be in format YYYY-YY (e.g., 2023-24)')
  }

  const [startYear, endYearSuffix] = taxYear.split('-')
  const startYearNum = parseInt(startYear)
  const endYearNum = parseInt('20' + endYearSuffix)

  if (endYearNum !== startYearNum + 1) {
    throw new ValidationError('Tax year end must be one year after start')
  }
}

// Get current tax year
export function getCurrentTaxYear(): string {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-12
  
  // Tax year starts April 6
  if (currentMonth < 4 || (currentMonth === 4 && now.getDate() < 6)) {
    return `${currentYear - 1}-${String(currentYear).slice(2)}`
  } else {
    return `${currentYear}-${String(currentYear + 1).slice(2)}`
  }
}

// Check if date falls within tax year
export function isDateInTaxYear(date: string, taxYear: string): boolean {
  const [startYear] = taxYear.split('-')
  const startYearNum = parseInt(startYear)
  
  const taxYearStart = new Date(startYearNum, 3, 6) // April 6
  const taxYearEnd = new Date(startYearNum + 1, 3, 5) // April 5 next year
  const donationDate = new Date(date)
  
  return donationDate >= taxYearStart && donationDate <= taxYearEnd
}

// Comprehensive validation for entire claim
export function validateR68Claim(claim: any): void {
  // Validate charity details
  if (!validateHMRCReference(claim.charity.charityHMRCRef)) {
    throw new ValidationError('Invalid HMRC reference format (should be A1234B)')
  }
  
  if (!validateCharityNumber(claim.charity.charityNumber, claim.charity.regulatorCode)) {
    throw new ValidationError(`Invalid charity number for regulator ${claim.charity.regulatorCode}`)
  }

  validateTaxYear(claim.taxYear)

  // Validate each donation
  claim.donations.forEach((donation: any, index: number) => {
    const donorNum = index + 1
    
    try {
      validateName(donation.donor.forename, 'Forename')
      validateName(donation.donor.surname, 'Surname')
      
      if (!donation.donor.houseNameNumber || donation.donor.houseNameNumber.length > 50) {
        throw new ValidationError('House name/number required (max 50 characters)')
      }
      
      if (!validatePostcode(donation.donor.postcode)) {
        throw new ValidationError('Invalid UK postcode format')
      }
      
      validateAmount(donation.amount)
      validateDonationDate(donation.date, donation.date) // Simplified - adjust based on your declaration date field
      
      if (!isDateInTaxYear(donation.date, claim.taxYear)) {
        throw new ValidationError(`Donation date not in tax year ${claim.taxYear}`)
      }
      
    } catch (error) {
      throw new ValidationError(`Donor ${donorNum}: ${error.message}`)
    }
  })

  // Validate totals
  const totalDonations = claim.donations.reduce((sum: number, d: any) => sum + d.amount, 0)
  if (totalDonations < 1) {
    throw new ValidationError('Total donations must be at least £1.00')
  }
}
