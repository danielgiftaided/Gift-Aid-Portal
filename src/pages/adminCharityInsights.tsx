import { useParams } from 'react-router-dom'
import AdminCharityAnalyticsPage from '../components/analytics/AdminCharityAnalyticsPage'
import { userExportRecords } from '../../shared/giftAidRecords'
import { type AnalyticsRecord } from '../../shared/analytics'
import { downloadRecordCsv } from '../utils/analyticsData'

export default function AdminCharityInsights() {
  const { id } = useParams<{ id: string }>()
  if (!id)
    return <p className="p-6 text-red-700">Charity workspace not found.</p>
  return (
    <AdminCharityAnalyticsPage
      key={id}
      id={id}
      onExport={(rows: AnalyticsRecord[], mode) =>
        downloadRecordCsv(userExportRecords(rows, mode), mode)
      }
    />
  )
}
