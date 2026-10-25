export const hmrcStatuses = [
  { value: 'not_submitted', label: 'Not submitted' },
  { value: 'validation_failed', label: 'Validation failed' },
  { value: 'ready_to_send', label: 'Ready to send' },
  { value: 'sent', label: 'Sent' },
  { value: 'polling', label: 'Awaiting response' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'error', label: 'Error' },
] as const

export type HmrcStatus = typeof hmrcStatuses[number]['value']

export function isHmrcStatus(value: unknown): value is HmrcStatus {
  return hmrcStatuses.some(status => status.value === value)
}

export function hmrcStatusLabel(value: string | null | undefined): string {
  return hmrcStatuses.find(status => status.value === (value ?? 'not_submitted'))?.label
    ?? String(value).replace(/_/g, ' ')
}
