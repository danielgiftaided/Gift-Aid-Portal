# Insights and reporting

The portfolio (`/admin/insights`), admin charity workspace insights and pending-charity insights share a reporting workspace. Tax-year and portfolio charity filters affect headline totals, charts and exports. Charts have text/table alternatives and the report supports narrow screens and printing.

## Views

- **Overview:** recorded versus HMRC-accepted claim value, status pipeline and charity contribution rankings (or record composition for an individual charity). Year and charity selections filter the workspace; status selections open the submission register.
- **Donation patterns:** monthly donation activity, switchable area/column charts and value/count measures, donation-size distribution and donation value by tax year. Missing months appear as zero; undated rows are excluded and counted explicitly.
- **Data quality:** mutually exclusive record groups and a tax-year heatmap. Select a cell to filter the year and inspect up to 50 matching record rows. Opted-out and historic donations are not presented as recoverable Gift Aid.
- **Claim operations:** searchable, paginated submissions with HMRC and portal display statuses shown separately. Submission links retain the correct admin/charity return path.

**Export report** produces an Excel workbook with Summary, By tax year, Record quality, Record detail, Claims and Monthly donations sheets. The Claims sheet respects its status/search filters and Record detail respects its selected quality group, with these selections recorded in Summary; dashboard totals respect the tax-year/charity filters. **Print / PDF** prints the selected view. Existing full-file and eligible-record donor CSV exports remain available on individual-charity pages and respect dashboard filters. CSV text cells are escaped and protected against formula interpretation.

## Metric definitions

- Recorded claim value sums `submissions.amount_claimed` across all statuses. It can include GASDS and adjustments; it is not calculated by multiplying all donations by 25%.
- HMRC-accepted value includes only `hmrc_status = accepted`. Portal `status = approved` is an editable display state and is not evidence of HMRC acceptance. Acceptance is not evidence of payment.
- Eligible estimate uses 25% of valid, opted-in, Gift Aided records. The incomplete opted-in estimate excludes consent gaps and records marked as claimed by another provider. Eligibility and deadlines must still be checked; neither estimate is a confirmed entitlement.
- Donation activity uses `uploaded_records` (or staged records for pending charities), not the separate donations table, so rows are not double-counted across sources. It counts imported donation rows, not unique donors. Manually entered claim data not present in uploads contributes to recorded claims but not imported donation charts.
- Tax year is derived from a valid UK/ISO donation date, with 6 April as the boundary. Otherwise the saved year or `Unknown` is used.

## Deployment

Deploy the updated portfolio API and frontend together. All report sources page in stable ID order; the portfolio client reads uploaded-record pages through the operator-only API in batches of 1,000 so large files do not exceed server response limits. A failed page blocks the report rather than displaying partial totals. Portfolio responses omit donor names, addresses and postcodes. Admin charity pages retain their existing session/RLS access paths. The charity-facing `/insights` page and its existing status hook are unchanged by this admin-only rollout.

The connected project supports the main portfolio/charity reporting columns. Its **pending** records table is missing `gift_aid_submitted`; apply the existing `supabase/migrations/20260929000000_add_gift_aid_submitted.sql` migration before using pending insights. No remote schema or records were changed as part of this work. No new package or external analytics service is required.

## Validation

Regression tests cover metric separation, consent exclusions, date boundaries, year/charity filters, monthly gaps, distribution boundaries, empty states, export escaping, API authorization/pagination and client pagination failures. Desktop/mobile browser checks use synthetic data to exercise views, cross-filtering, tables and Excel export. Read-only database checks verify source columns; the authenticated deployed UI was not exercised.

## Rollout scope

This PR updates only admin portfolio, admin charity and pending-charity insights. The existing charity-facing insights page, its layout, exports, navigation and shared status hook remain unchanged. The new admin charity loader requires an explicit charity ID and uses a separate admin status hook. The full rollout in PR #19 can be revisited after admin review.

## Admin dashboard usability review

Admin reports now use the portal's existing logo green (`#0c745d`), navy (`#304675`) and a warm neutral surface. Larger text, stronger contrast, a visible selected report, wrapped mobile navigation and accessible return navigation make the workspace easier to scan. Overview shortcuts open the incomplete opted-in record group or the submission register without discarding the current year/charity filters. The underlying metrics and export formats are unchanged. Calculation guidance is available in an expandable section.

To review the proposed charity reporting experience, open a charity from **Admin → Charities**, then its **Insights** page (`/admin/charities/:id/insights`). It uses the same reporting component as the portfolio, scoped to that charity, with charity-facing headings and an admin-only preview banner. Logo and report navigation stay in that charity's preview; the banner returns to its admin detail page. This previews reporting, not the upload/profile workflows. Existing charity-facing `/dashboard` and `/insights` remain unchanged. Pending-charity reports retain staged-data wording.

Validation for this refinement: all eight regression test files and the Vite production build pass. Synthetic-data browser checks at 1440px and 390px cover suggested actions, record detail, claim search, clearing filters, report navigation and horizontal overflow. Authenticated live data was not exercised. TypeScript reports the same twelve errors as the unchanged main branch, in unrelated files; no new type errors were introduced. This change is prepared for review in a PR and is not merged or deployed.
