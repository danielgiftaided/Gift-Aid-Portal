# Incomplete records and user exports

Missing first name, last name, address or postcode marks an upload row
incomplete, even if the donor opted out. Donation date and positive amount
remain required; title remains optional. Consent is preserved in the
Gift Aid Opt-In value, separately from the stored completeness status.

Upload previews and charity/admin insights show incomplete opted-in and
incomplete opted-out counts separately. No, N, empty and whitespace-only
opt-in values count as opted out, regardless of case.

The charity insights page offers two CSV exports:

- Full file: every stored uploaded row, including historic, incomplete and
  opted-out rows. This exports the portal's mapped columns, not unmapped
  columns from the original workbook.
- Gift Aided submitted (valid): only valid, opted-in records whose
  Gift Aid Submitted flag is not false, using the existing flag semantics.

Both exports include the submission flag and record group. Separate user
exports for historic, incomplete or opted-out records are removed. Admins
retain category exports, including the two incomplete consent groups.

Completing an opted-out donor's details through donor matching must not
create a claim. Historic records also remain outside Gift Aided submissions.

## Deployment

Apply `supabase/migrations/20261005010000_reclassify_incomplete_consent.sql`
alongside deploying the application. It updates existing uploaded and
pending reporting rows with missing mandatory fields to incomplete and
complete No/N/blank rows to opted out. It preserves raw consent and does not
delete or change existing donations, submission totals or HMRC claims.
Any previous claim containing an affected row needs a separate review.

Run `node --test tests/*.test.cjs` and `npm run build` for validation.
