import { hmrcStatusLabel } from '../../shared/hmrcStatus'

export function hmrcStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'accepted': return 'bg-green-100 text-green-700'
    case 'rejected':
    case 'error':
    case 'validation_failed': return 'bg-red-100 text-red-700'
    case 'ready_to_send': return 'bg-blue-100 text-blue-700'
    case 'sent':
    case 'polling': return 'bg-amber-100 text-amber-700'
    default: return 'bg-gray-100 text-gray-500'
  }
}

export default function HmrcStatusBadge({ status }: { status: string | null | undefined }) {
  return <span className={`text-xs font-semibold px-2 py-1 rounded ${hmrcStatusColor(status)}`}>
    {hmrcStatusLabel(status)}
  </span>
}
