/**
 * Derives the simple, app-wide submission status (pending / submitted /
 * approved / rejected — the vocabulary already used by dashboard stat
 * cards, insights, etc.) from the detailed HMRC pipeline status.
 *
 * This exists so the "Status" column on a submission is always a true
 * reflection of what's actually happened with it, rather than something an
 * admin has to remember to update by hand. Every place that changes
 * hmrc_status should call this and write the result to `status` in the
 * same update, rather than leaving the two to drift apart.
 */

export type SimpleStatus = 'pending' | 'submitted' | 'approved' | 'rejected'

export function deriveStatus(hmrcStatus: string): SimpleStatus {
  switch (hmrcStatus) {
    case 'accepted':
      return 'approved'
    case 'rejected':
    case 'error':
      return 'rejected'
    case 'sent':
    case 'polling':
      return 'submitted'
    case 'not_submitted':
    case 'validation_failed':
    case 'ready_to_send':
    default:
      return 'pending'
  }
}
