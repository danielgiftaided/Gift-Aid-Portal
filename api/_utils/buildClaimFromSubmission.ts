/**
 * Maps the portal's existing database rows (charities / submissions /
 * donations) into the GiftAidClaimInput shape expected by r68XmlBuilder.ts.
 *
 * This is deliberately a TWO-STEP process — validate, then build — rather
 * than one function that silently produces XML. HMRC's validation rules are
 * strict and unforgiving (e.g. a malformed title or out-of-format charity
 * reference causes outright rejection), so problems need to surface clearly
 * BEFORE a submission is attempted, not as a cryptic HMRC error after the
 * fact.
 *
 * CONFIRMED BY THE REAL R68 SCHEMA (not just documentation): AuthOfficial
 * and AgtOrNom are mutually exclusive alternatives for identifying who is
 * making the claim, not fields that both belong inside <Claim> together.
 * Since Gift Aided always submits as agent, only AgtOrNom applies, and it
 * sits as a sibling of <Claim> at the R68 level — never AuthOfficial.
 * Authorised Official name is therefore NOT part of this XML at all. It's
 * still captured and stored (likely needed for HMRC's separate agent
 * authorisation paperwork, not for individual claims), so the check below
 * is a non-blocking warning rather than an error.
 *
 * KNOWN GAPS this file surfaces (flagged, not silently worked around):
 *
 * 1. RESOLVED — Authorised Official name is no longer part of this XML at
 *    all (see explanation above). It's kept as a non-blocking warning
 *    purely because it's still useful data to have on file for other
 *    purposes, not because this submission needs it.
 *
 * 2. The existing charity_number validation (in api/charity/setup.ts) only
 *    checks for 3-30 alphanumeric characters. HMRC's actual format is much
 *    stricter: up to 2 alphabetic characters followed by up to 5 numeric
 *    characters, and must NOT end in /0, /1, or /2. A charity could have
 *    been onboarded with a reference that passes the portal's own check
 *    but will be rejected by HMRC. validateHmrcCharityReference() below
 *    catches this before attempting a submission, but it's worth tightening
 *    the original signup validation too so this is caught at onboarding
 *    time rather than at first-claim time.
 *
 * 3. Donor address is stored as a single free-text field in `donations`,
 *    but the R68 <House> element has a 40-character limit. Addresses
 *    longer than that get truncated here with a warning rather than
 *    silently cut — review any truncation warnings before submitting.
 *
 * 4. The Agent/Nominee reference is specific to each individual charity
 *    relationship with HMRC — NOT a single Gift-Aided-wide value. It must
 *    come from the charity's own row (agent_nominee_reference), set once
 *    HMRC issues it for that specific charity. Earlier scaffolding treated
 *    this as a single shared env var, which was wrong — corrected here.
 */

import { GiftAidClaimInput, GiftAidDonor } from './r68XmlBuilder'

export interface CharityRow {
  id: string
  name: string
  charity_id: string // the HMRC Charities reference, e.g. "AB12345"
  charity_number?: string | null // the Charity Commission (or OSCR/CCNI) registration number — a DIFFERENT number from charity_id
  authorised_official_name?: string | null
  agent_nominee_reference?: string | null // specific to this charity's relationship with HMRC — not shared across charities
}

export interface SubmissionRow {
  id: string
  charity_id: string
  tax_year: string
  status: string
}

export interface DonationRow {
  id: string
  title: string | null
  first_name: string | null
  last_name: string | null
  address: string | null
  postcode: string | null
  donation_date: string | null
  amount: number | null
}

export interface MappingResult {
  claim: GiftAidClaimInput | null
  errors: string[]   // blocking — submission must not proceed if non-empty
  warnings: string[] // non-blocking — surfaced for review, e.g. truncation
}

/**
 * Validates an HMRC Charities reference format: up to 2 alphabetic
 * characters followed by up to 5 numeric characters, and must not end in
 * /0, /1, or /2 (per Charities Online Additional Guidance v1.1, section 2.4).
 */
export function validateHmrcCharityReference(reference: string): string | null {
  const trimmed = reference.trim().toUpperCase()
  if (!/^[A-Z]{1,2}[0-9]{1,5}$/.test(trimmed)) {
    return `Charity reference "${reference}" doesn't match HMRC's expected format (1-2 letters followed by 1-5 numbers, e.g. "AB12345").`
  }
  if (/\/(0|1|2)$/.test(trimmed)) {
    return `Charity reference "${reference}" ends in /0, /1 or /2, which HMRC no longer accepts for sub-funds.`
  }
  return null
}

/**
 * Parses a UK-format donation date (DD/MM/YYYY or DD/MM/YY, both seen in
 * real data) into the ccyy-mm-dd format the R68 schema requires, with the
 * same range validation and rollover rejection used elsewhere — confirmed
 * mandatory by real LTS schema validation (see r68XmlBuilder.ts).
 *
 * 2-digit years are assumed to be 20YY, not 19YY — Gift Aid claims can only
 * realistically cover the last few years, so this is a safe assumption for
 * this specific use case (it would NOT be a safe general-purpose rule).
 */
function parseAndFormatDonationDate(raw: string): string | null {
  const trimmed = raw.trim()
  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10)
    const year = dmy[3].length === 2 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day)
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) {
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      }
    }
    return null
  }
  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (ymd) return trimmed // already in the right format
  return null
}

/**
 * Validates and sanitises a single donation row into a GiftAidDonor, or
 * returns a list of blocking errors if it can't be made valid.
 */
function mapDonor(row: DonationRow, warnings: string[]): { donor: GiftAidDonor | null; errors: string[] } {
  const errors: string[] = []

  if (!row.first_name) errors.push(`Donation ${row.id}: missing first name`)
  if (!row.last_name) errors.push(`Donation ${row.id}: missing last name`)
  if (!row.address) errors.push(`Donation ${row.id}: missing address`)
  if (!row.postcode) errors.push(`Donation ${row.id}: missing postcode`)
  if (row.amount == null || row.amount <= 0) errors.push(`Donation ${row.id}: missing or invalid amount`)

  let formattedDate: string | null = null
  if (!row.donation_date) {
    errors.push(`Donation ${row.id}: missing donation date — required by HMRC's schema`)
  } else {
    formattedDate = parseAndFormatDonationDate(row.donation_date)
    if (!formattedDate) errors.push(`Donation ${row.id}: donation date "${row.donation_date}" could not be parsed into a valid date`)
  }

  if (errors.length > 0) {
    return { donor: null, errors }
  }

  // Title: 1-4 chars, upper/lower alpha plus backslash and hyphen only.
  let title: string | undefined
  if (row.title) {
    const cleanedTitle = row.title.trim()
    if (/^[A-Za-z\\-]{1,4}$/.test(cleanedTitle)) {
      title = cleanedTitle
    } else {
      warnings.push(`Donation ${row.id}: title "${row.title}" doesn't meet HMRC's format (1-4 letters, backslash or hyphen only) — omitted from submission.`)
    }
  }

  // House field: 40-character limit, confirmed by the real R68 schema.
  // Truncate at the last whole word rather than mid-word — the postcode is
  // a separate field and unaffected, so this is purely cosmetic, but a
  // submission ending mid-word looks sloppy on an official document.
  let house = row.address!.trim()
  if (house.length > 40) {
    const hardCut = house.slice(0, 40)
    const lastSpace = hardCut.lastIndexOf(' ')
    const wordBoundaryCut = lastSpace > 20 ? hardCut.slice(0, lastSpace) : hardCut // don't over-shorten if the last word break is too early
    warnings.push(`Donation ${row.id}: address truncated to fit HMRC's 40-character limit ("${house}" -> "${wordBoundaryCut}"). Review before submitting.`)
    house = wordBoundaryCut
  }

  return {
    donor: {
      title,
      firstName: row.first_name!,
      lastName: row.last_name!,
      houseNameOrNumber: house,
      postcode: row.postcode!.trim().toUpperCase(),
      donationDate: formattedDate!,
      amount: Math.round(row.amount! * 100) / 100,
    },
    errors: [],
  }
}

/**
 * Builds a GiftAidClaimInput from a charity, a submission, and its
 * associated valid donations — or returns blocking errors if anything
 * required is missing or malformed.
 *
 * NOTE: only pass donations already categorised as 'valid' — this function
 * does not re-check record_status itself, since that categorisation has
 * already happened upstream during upload.
 */
export function buildClaimFromSubmission(
  charity: CharityRow,
  submission: SubmissionRow,
  donations: DonationRow[]
): MappingResult {
  const errors: string[] = []
  const warnings: string[] = []

  const refError = validateHmrcCharityReference(charity.charity_id)
  if (refError) errors.push(refError)

  if (!charity.authorised_official_name) {
    warnings.push(
      `${charity.name} has no Authorised Official name on file. This isn't required for this specific submission, but is likely needed for HMRC's separate agent authorisation paperwork — worth adding when convenient.`
    )
  }

  if (!charity.agent_nominee_reference) {
    errors.push(
      `${charity.name} has no Agent/Nominee reference on file. HMRC issues this specifically for Gift Aided's relationship with each charity — add it to this charity's record before submitting this claim.`
    )
  }

  if (!charity.charity_number) {
    errors.push(
      `${charity.name} has no Charity Commission registration number on file (charity_number column). HMRC's business rules require this whenever Regulator details are included, which is mandatory for any charity reference not starting with CH or CF — add it to this charity's record before submitting this claim.`
    )
  }

  if (donations.length === 0) {
    errors.push(`Submission ${submission.id} has no donations to claim.`)
  }

  const mappedDonors: GiftAidDonor[] = []
  for (const row of donations) {
    const { donor, errors: donorErrors } = mapDonor(row, warnings)
    if (donorErrors.length > 0) {
      errors.push(...donorErrors)
    } else if (donor) {
      mappedDonors.push(donor)
    }
  }

  if (mappedDonors.length > 500_000) {
    errors.push(`Submission ${submission.id} has ${mappedDonors.length} donations, exceeding HMRC's 500,000-per-submission limit. This needs splitting into multiple submissions.`)
  }

  if (errors.length > 0) {
    return { claim: null, errors, warnings }
  }

  return {
    claim: {
      charityHmrcReference: charity.charity_id.trim().toUpperCase(),
      agentOrNomineeReference: charity.agent_nominee_reference!,
      claimingOrganisationName: charity.name,
      taxYear: submission.tax_year,
      regulatorNumber: charity.charity_number || undefined,
      donations: mappedDonors,
    },
    errors: [],
    warnings,
  }
}
