# Admin submission statuses

In Admin → Charity → Submissions, use the HMRC Status selector to record
Not submitted, Validation failed, Sent, Awaiting response, Accepted, Rejected
or Error. Changes save automatically and update both `hmrc_status` and the
general `status` in one operation: Accepted → Approved; Sent/Awaiting response
→ Submitted; Rejected/Error → Rejected; Not submitted/Validation failed
→ Pending. Ready to send remains controlled by Build HMRC Claim so manual
changes cannot bypass claim validation.

The HMRC status endpoint requires an authenticated operator, scopes the update
to the submission and charity, checks both previous statuses for conflicts,
and records the operator and old/new values in the activity log. It does not
send a claim, poll HMRC or rewrite claim XML, references or response evidence.
Subsequent automated HMRC processing may update the statuses again.

The charity dashboard and submission detail now show the HMRC status alongside
the general status. Both refresh automatically through the existing Realtime,
five-second polling and focus refresh, including the dashboard's Approved count.
Existing admin reporting also refreshes its HMRC status metrics automatically.

In Admin → Charity → Submissions, choose Pending, Submitted, Approved or
Rejected in the Status column. The change saves automatically. A failed save
leaves the previous status displayed and shows an error. Conflicting changes
refresh the table so the operator can review the current status before retrying.

Only authenticated operators can use the update endpoint. It updates the
existing submission status and records the operator and old/new values in the
activity log. It does not change HMRC processing fields or send a claim.
Subsequent HMRC processing can update the display status through the existing
status derivation logic.

## Deployment

Apply `supabase/migrations/20261005000000_submission_status_realtime.sql`
to the project's Supabase database alongside deploying the application.
It adds submissions to the Realtime publication if needed, leaving existing
row-level security policies in place.

Open charity dashboard, submission detail and insights pages refresh their
statuses on database update events without a manual page reload. A five-second
poll and a refresh when the browser regains focus recover missed events and
provide automatic updates if Realtime is unavailable. Without the migration,
changes appear through this fallback rather than immediately.

## Checks

Run `node --test --test-isolation=none tests/submission-status.test.cjs tests/hmrc-status.test.cjs`
and `npm run build`.
For deployment verification, open the charity portal and its admin charity
page in separate sessions; change a status and check the dashboard badge,
Approved count, submission detail badge and insights status-based totals.
