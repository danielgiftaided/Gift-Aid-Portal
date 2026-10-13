import { useParams } from 'react-router-dom'
import CharityAnalyticsPage from '../components/analytics/CharityAnalyticsPage'
import { userExportRecords } from '../../shared/giftAidRecords'
import { type AnalyticsRecord } from '../../shared/analytics'
import { downloadRecordCsv } from '../utils/analyticsData'

export default function AdminCharityInsights() {
  const { id } = useParams<{ id: string }>()
  return (
    <CharityAnalyticsPage
      key={id}
      id={id}
      onExport={(rows: AnalyticsRecord[], mode) =>
        downloadRecordCsv(userExportRecords(rows, mode), mode)
      }
    />
  )
}
