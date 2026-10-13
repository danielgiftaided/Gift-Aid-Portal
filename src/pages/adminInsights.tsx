import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadPortfolioAnalytics } from '../utils/analyticsData'
import AnalyticsWorkspace, {
  AnalyticsFrame,
} from '../components/analytics/AnalyticsWorkspace'
import {
  type AnalyticsSubmission,
  type AnalyticsRecord,
  type AnalyticsCharity,
} from '../../shared/analytics'
interface PortalAnalytics {
  submissions: AnalyticsSubmission[]
  records: AnalyticsRecord[]
  charities: AnalyticsCharity[]
}
export default function AdminInsights() {
  const navigate = useNavigate()
  const [data, setData] = useState<PortalAnalytics>({
    submissions: [],
    records: [],
    charities: [],
  })
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
        navigate('/login')
        return
      }
      setData(await loadPortfolioAnalytics(session.access_token))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load insights')
    } finally {
      setLoading(false)
    }
  }, [navigate])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <AnalyticsFrame
      title="Insights & reporting"
      subtitle="Your portfolio at a glance. Explore performance, discover patterns and take action."
      admin
      back="/admin"
    >
      <AnalyticsWorkspace
        {...data}
        submissionBackPath="/admin/insights"
        loading={loading}
        error={error}
        onRefresh={() => void load()}
      />
    </AnalyticsFrame>
  )
}
