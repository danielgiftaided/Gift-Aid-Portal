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
 * KNOWN GAPS this file surfaces (flagged, not silently worked around):
 *
 * 1. Authorised Official name (<OffName>) is mandatory on every claim, but
 *    nothing in the current charity setup/profile flow captures it. This
 *    needs adding as a field on the charities table and on the
 *    charitySetup.tsx / charityProfile.tsx forms before this can run for
 *    real — see `authorisedOfficialName` parameter below, currently passed
 *    in rather than read from the charity row, precisely because it
 *    doesn't exist there yet.
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
 * 4. The Agent/Nominee reference is a single, Gift-Aided-wide value (your
 *    own HMRC Charities Agent Reference), not something stored per
 *    charity — it should come from a single source of config (env var),
 *    not the database. See AGENT_OR_NOMINEE_REFERENCE below.
 */

import { GiftAidClaimInput, GiftAidDonor } from './r68XmlBuilder'

// Your own HMRC Charities Agent Reference, issued separately from the
// Vendor ID — applies to every claim submitted on behalf of any charity.
// Set this in Vercel's environment variables once HMRC confirms it; do not
// hard-code it here.
const AGENT_OR_NOMINEE_REFERENCE = process.env.HMRC_AGENT_NOMINEE_REFERENCE || ''

export interface CharityRow {
  id: string
  name: string
  charity_id: string // the HMRC Charities reference, e.g. "AB12345"
  authorised_official_name?: string | null // does not exist on the table yet — see file header
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

  // House field: 40-character limit per the technical pack.
  let house = row.address!.trim()
  if (house.length > 40) {
    warnings.push(`Donation ${row.id}: address truncated to 40 characters for HMRC submission ("${house}" -> "${house.slice(0, 40)}"). Review before submitting.`)
    house = house.slice(0, 40)
  }

  return {
    donor: {
      title,
      firstName: row.first_name!,
      lastName: row.last_name!,
      houseNameOrNumber: house,
      postcode: row.postcode!.trim().toUpperCase(),
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
    errors.push(
      `${charity.name} has no Authorised Official name on file. This is mandatory for HMRC submission — add it to the charity's profile before submitting this claim.`
    )
  }

  if (!AGENT_OR_NOMINEE_REFERENCE) {
    errors.push(
      'HMRC_AGENT_NOMINEE_REFERENCE is not configured. Set this in environment variables before any live submission — see file header for context.'
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
      agentOrNomineeReference: AGENT_OR_NOMINEE_REFERENCE,
      claimingOrganisationName: charity.name,
      authorisedOfficialName: charity.authorised_official_name!,
      taxYear: submission.tax_year,
      donations: mappedDonors,
    },
    errors: [],
    warnings,
  }
}
