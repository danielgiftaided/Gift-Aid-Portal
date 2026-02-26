export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function validatePostcode(postcode: string): boolean {
  const postcodeRegex = /^[A-Z]{1,2}[0-9R][0-9A-Z]?\s?[0-9][A-Z]{2}$/i
  return postcodeRegex.test(postcode.trim())
}

export function validateHMRCReference(ref: string): boolean {
  const hmrcRefRegex = /^[A-Z]\d{4}[A-Z]$/
  return hmrcRefRegex.test(ref.trim())
}

export function validateCharityNumber(number: string, regulator: string): boolean {
  const trimmed = number.trim()
  
  switch (regulator) {
    case 'CCEW':
      return /^\d{6,7}$/.test(trimmed)
    case 'OSCR':
      return /^SC\d{6}$/i.test(trimmed)
    case 'CCNI':
      return /^NIC\d{6}$/i.test(trimmed)
    default:
      return false
  }
}

export function validateAmount(amount: number): void {
  if (typeof amount !== 'number' || isNaN(amount)) {
    throw new ValidationError('Amount must be a valid number')
  }
  
  if (amount < 1) {
    throw new ValidationError('Donation amount must be at least £1.00')
  }
  
  if (amount > 999999.99) {
    throw new ValidationError('Donation amount cannot exceed £999,999.99')
  }
  
  if (Math.round(amount * 100) / 100 !== amount) {
    throw new ValidationError('Amount must have at most 2 decimal places')
  }
}

export function validateName(name: string, fieldName: string): void {
  if (!name || name.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required`)
  }
  
  const trimmed = name.trim()
  
  if (trimmed.length > 35) {
    throw new ValidationError(`${fieldName} must be 35 characters or less`)
  }
  
  if (!/^[a-zA-Z\s'\-]+$/.test(trimmed)) {
    throw new ValidationError(
      `${fieldName} can only contain letters, spaces, hyphens, and apostrophes`
    )
  }
}

export function validateDateFormat(date: string, fieldName: string): void {
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  
  if (!dateRegex.test(date)) {
    throw new ValidationError(`${fieldName} must be in YYYY-MM-DD format`)
  }
  
  const parsed = new Date(date)
  if (isNaN(parsed.getTime())) {
    throw new ValidationError(`${fieldName} is not a valid date`)
  }
}

export function validateDonationDates(donationDate: string, declarationDate: string): void {
  validateDateFormat(donationDate, 'Donation date')
  validateDateFormat(declarationDate, 'Declaration date')

  const donation = new Date(donationDate)
  const declaration = new Date(declarationDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (donation > today) {
    throw new ValidationError('Donation date cannot be in the future')
  }

  if (declaration > donation) {
    throw new ValidationError('Declaration date must be on or before donation date')
  }

  const fourYearsAgo = new Date()
  fourYearsAgo.setFullYear(fourYearsAgo.getFullYear() - 4)
  fourYearsAgo.setMonth(3)
  fourYearsAgo.setDate(6)
  
  if (declaration < fourYearsAgo) {
    throw new ValidationError('Declaration date must be within the last 4 tax years')
  }
}

export function validateTaxYear(taxYear: string): void {
  const taxYearRegex = /^\d{4}-\d{2}$/
  
  if (!taxYearRegex.test(taxYear)) {
    throw new ValidationError('Tax year must be in format YYYY-YY (e.g., 2024-25)')
  }

  const [startYear, endYearSuffix] = taxYear.split('-')
  const startYearNum = parseInt(startYear, 10)
  const endYearNum = parseInt('20' + endYearSuffix, 10)

  if (endYearNum !== startYearNum + 1) {
    throw new ValidationError('Tax year end must be one year after start')
  }
  
  const currentTaxYear = getCurrentTaxYear()
  const [currentStart] = currentTaxYear.split('-')
  const currentStartNum = parseInt(currentStart, 10)
  
  if (startYearNum > currentStartNum) {
    throw new ValidationError('Cannot claim for future tax years')
  }
}

export function getCurrentTaxYear(): string {
  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const currentDay = now.getDate()
  
  if (currentMonth < 4 || (currentMonth === 4 && currentDay < 6)) {
    return `${currentYear - 1}-${String(currentYear).slice(2)}`
  } else {
    return `${currentYear}-${String(currentYear + 1).slice(2)}`
  }
}

export function isDateInTaxYear(date: string, taxYear: string): boolean {
  const [startYearStr] = taxYear.split('-')
  const startYear = parseInt(startYearStr, 10)
  
  const taxYearStart = new Date(startYear, 3, 6)
  const taxYearEnd = new Date(startYear + 1, 3, 5)
  const donationDate = new Date(date)
  
  return donationDate >= taxYearStart && donationDate <= taxYearEnd
}

export function validateR68Claim(claim: any): void {
  const errors: string[] = []

  try {
    if (!claim.charity) {
      throw new ValidationError('Charity details are required')
    }

    if (!validateHMRCReference(claim.charity.charityHMRCRef)) {
      errors.push('Invalid HMRC reference format (should be like A1234B)')
    }
    
    if (!validateCharityNumber(claim.charity.charityNumber, claim.charity.regulatorCode)) {
      errors.push(`Invalid charity number for regulator ${claim.charity.regulatorCode}`)
    }

    if (!claim.charity.charityName || claim.charity.charityName.trim().length === 0) {
      errors.push('Charity name is required')
    }

  } catch (error) {
    if (error instanceof ValidationError) {
      errors.push(error.message)
    }
  }

  try {
    validateTaxYear(claim.taxYear)
  } catch (error) {
    if (error instanceof ValidationError) {
      errors.push(error.message)
    }
  }

  if (!claim.donations || claim.donations.length === 0) {
    errors.push('At least one donation is required')
  } else {
    claim.donations.forEach((donation: any, index: number) => {
      const donorNum = index + 1
      
      try {
        validateName(donation.donor.forename, `Donor ${donorNum} forename`)
        validateName(donation.donor.surname, `Donor ${donorNum} surname`)
        
        if (!donation.donor.houseNameNumber || donation.donor.houseNameNumber.trim().length === 0) {
          errors.push(`Donor ${donorNum}: House name/number is required`)
        } else if (donation.donor.houseNameNumber.length > 50) {
          errors.push(`Donor ${donorNum}: House name/number must be 50 characters or less`)
        }
        
        if (!validatePostcode(donation.donor.postcode)) {
          errors.push(`Donor ${donorNum}: Invalid UK postcode format`)
        }
        
        validateAmount(donation.amount)
        
        validateDonationDates(donation.donationDate, donation.declarationDate)
        
        if (!isDateInTaxYear(donation.donationDate, claim.taxYear)) {
          errors.push(`Donor ${donorNum}: Donation date ${donation.donationDate} not in tax year ${claim.taxYear}`)
        }
        
      } catch (error) {
        if (error instanceof ValidationError) {
          errors.push(`Donor ${donorNum}: ${error.message}`)
        }
      }
    })
  }

  if (claim.donations && claim.donations.length > 0) {
    const totalDonations = claim.donations.reduce((sum: number, d: any) => sum + (d.amount || 0), 0)
    
    if (totalDonations < 1) {
      errors.push('Total donations must be at least £1.00')
    }
  }

  if (claim.otherIncome < 0) {
    errors.push('Other income cannot be negative')
  }

  if (claim.adjustment && (!claim.adjustmentAmount || claim.adjustmentAmount === 0)) {
    errors.push('Adjustment amount is required when adjustment is selected')
  }

  if (errors.length > 0) {
    throw new ValidationError(errors.join('; '))
  }
}

export default {
  ValidationError,
  validatePostcode,
  validateHMRCReference,
  validateCharityNumber,
  validateAmount,
  validateName,
  validateDateFormat,
  validateDonationDates,
  validateTaxYear,
  getCurrentTaxYear,
  isDateInTaxYear,
  validateR68Claim
}
