# Regenerate the HMRC recognition package

Apply `20261008000000_gasds_adjustment_explanation.sql` to the development/test Supabase project before deploying this change. It adds the GASDS explanation field and preserves sponsored flags on imported records; it does not change existing record values.

Use the test data on page 4 of [HMRC Charities recognition process v1.7](https://assets.publishing.service.gov.uk/media/5a821a96e5274a2e87dc1295/Charities_recognition_process_v1.7.pdf).

1. Set Mrs Mary Smith's donation `sponsored` flag to true. Spreadsheet imports now accept an optional **Sponsored Event** column (`Yes`, `Y`, `True` or `1`). Existing records need correction; this change does not infer sponsorship from a donor's name. Avoid importing duplicate donations into the same claim.
2. For Captain William Black, use house/address `59` and postcode `BF1 2AB`, the MOD postcode for BFPO 8. Legacy postcode `BFPO 8` is normalised with a warning, and a trailing `BFPO 8` is removed from the address. Other legacy BFPO numbers require their verified UK-format postcode. The title is abbreviated to `Capt` to satisfy HMRC's four-character limit. Confirm this representation with HMRC during review; the recognition PDF supplies a legacy BFPO address, not explicit XML tags.
3. Keep the repayment adjustment at £50. Edit the GASDS claim and enter its separate £25 adjustment plus an explanation of the previous claim correction. Both explanations appear in `OtherInfo`; their combined length must not exceed 350 characters.
4. Rebuild the claim. Rebuilding clears old protocol evidence because it belongs to a different XML body/IRmark. Active sent/polling claims must finish before rebuilding.
5. Validate the exported R68 XML using LTS. The recognition export sets exactly one `GatewayTimestamp` to `2015-05-01T00:00:00`; this header change does not alter the IRmark body. The rest of the claim must retain the dates and figures specified by HMRC.
6. Generate a fresh ETS/ISV Reflector exchange and capture the acknowledgement, poll, final response, data request/response and delete request/response. Only polls go to `ResponseEndPoint`; list/delete requests go to the Transaction Engine submission endpoint. DATA_REQUEST uses the original sender authentication, an empty CorrelationID and the original GatewayTest flag. It queries by class; deleted submissions no longer appear in its results.
7. Export the recognition package. Failed acknowledgements/responses now prevent the package being marked ready. Individual files remain downloadable for diagnosis. The portal checks captured response qualifiers/errors; it does not replace LTS or HMRC recognition approval.

The original DATA_RESPONSE and DELETE_RESPONSE supplied for investigation contained fatal error 1001. Do not reuse or manually edit those responses to look successful. Capture genuine new responses. No existing Supabase data or HMRC submissions were changed while developing this fix.

References:

- [HMRC Transaction Engine Document Submission Protocol v2.0](https://assets.publishing.service.gov.uk/media/5b90f59de5274a0bd7d11954/Transaction.pdf), sections 3.7 and 3.9.
- [HMRC R68 v2.0 schema and business rules](https://www.gov.uk/government/publications/charities-technical-specifications-gift-aid-repayments-rim-artefacts): GASDS `Adj` is optional; when present it requires `OtherInfo`.
- [MOD BFPO directory](https://www.gov.uk/bfpo/find-a-bfpo-number): BFPO 8, Naples, BF1 2AB.
