import CharityAnalyticsPage from '../components/analytics/CharityAnalyticsPage'
import { userExportRecords } from '../../shared/giftAidRecords'
import { type AnalyticsRecord } from '../../shared/analytics'
import { downloadRecordCsv } from '../utils/analyticsData'

export default function Insights() {
  const exportRecords = (
    records: AnalyticsRecord[],
    mode: 'full' | 'valid',
  ) => {
    downloadRecordCsv(
      mode === 'full'
        ? userExportRecords(records, 'full')
        : userExportRecords(records, 'valid'),
      mode,
    )
  }
  return <CharityAnalyticsPage onExport={exportRecords} />
}
