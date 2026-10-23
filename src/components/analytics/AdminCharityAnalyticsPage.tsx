import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import {
  loadCharityAnalytics,
  type ReportingRecord,
} from '../../utils/analyticsData'
import {
  type AnalyticsRecord,
  type AnalyticsSubmission,
} from '../../../shared/analytics'
import { useAdminSubmissionStatuses } from '../../hooks/useAdminSubmissionStatuses'
import AnalyticsWorkspace, { AnalyticsFrame } from './AnalyticsWorkspace'

export default function AdminCharityAnalyticsPage({
  id,
  onExport,
}: {
  id: string
  onExport: (rows: AnalyticsRecord[], mode: 'full' | 'valid') => void
}) {
  const navigate = useNavigate()
  const [charityId, setCharityId] = useState<string>()
  const [name, setName] = useState('Charity workspace')
  const [data, setData] = useState<{
    submissions: AnalyticsSubmission[]
    records: ReportingRecord[]
  }>({ submissions: [], records: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        navigate('/admin/login')
        return
      }
      const { data: charity, error: charityError } = await supabase
        .from('charities')
        .select('name')
        .eq('id', id)
        .maybeSingle()
      if (charityError) throw new Error(charityError.message)
      if (!charity)
        throw new Error('Charity not found or unavailable to your account')
      setName(charity.name)

      setCharityId(id)
      setData(await loadCharityAnalytics(id))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load insights')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])
  useEffect(() => {
    void load()
  }, [load])
  // Both display status and HMRC status affect operational charts; refresh
  // their source rather than replacing only a display label.
  useAdminSubmissionStatuses('charity_id', charityId, (rows) => {
    if (loading) return
    if (
      rows.length !== data.submissions.length ||
      rows.some((row) => {
        const current = data.submissions.find((s) => s.id === row.id)
        return (
          !current ||
          current.status !== row.status ||
          current.hmrc_status !== row.hmrc_status
        )
      })
    )
      void load()
  })
  return (
    <AnalyticsFrame
      title={`${name} · Your Gift Aid overview`}
      subtitle="Understand your donations, check your data and follow your Gift Aid claims in one place."
      admin
      charityPreview
      back={`/admin/charities/${id}`}
    >
      <AnalyticsWorkspace
        scopeName={name}
        submissions={data.submissions}
        records={data.records}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        submissionBackPath={`/admin/charities/${id}/insights`}
        onRecordsExport={onExport}
      />
    </AnalyticsFrame>
  )
}
