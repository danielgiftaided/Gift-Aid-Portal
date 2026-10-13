import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../utils/fetchAll'
import { type AnalyticsRecord } from '../../shared/analytics'
import AnalyticsWorkspace, {
  AnalyticsFrame,
} from '../components/analytics/AnalyticsWorkspace'
import OnboardingChecklist from '../components/OnboardingChecklist'
export default function PendingCharityInsights() {
  const { email = '' } = useParams<{ email: string }>()
  const navigate = useNavigate()
  const [records, setRecords] = useState<AnalyticsRecord[]>([])
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
      setRecords(
        await fetchAllRows<AnalyticsRecord>(() =>
          supabase
            .from('pending_uploaded_records')
            .select(
              'id, record_status, tax_year, amount, donation_date, gift_aid_opt_in, gift_aid_submitted',
            )
            .eq('pending_email', email)
            .order('id', { ascending: true }),
        ),
      )
    } catch (e: unknown) {
      setError(
        e instanceof Error && e.message.includes('gift_aid_submitted')
          ? 'Pending donation reporting is not configured. Contact your system administrator.'
          : e instanceof Error
            ? e.message
            : 'Could not load staged records',
      )
    } finally {
      setLoading(false)
    }
  }, [email, navigate])
  useEffect(() => {
    void load()
  }, [load])
  return (
    <AnalyticsFrame
      title="Pending charity · Insights"
      subtitle={`Staged donation analysis for ${email}. Estimates are not submitted claims.`}
      admin
      back="/admin/pending-charities"
    >
      <AnalyticsWorkspace
        scopeName="Pending charity"
        submissions={[]}
        records={records}
        staged
        loading={loading}
        error={error}
        onRefresh={() => void load()}
      />
      <section className="max-w-[1560px] mx-auto px-6 sm:px-10 pb-12">
        <h2 className="text-lg font-semibold text-brand-primary mb-4">
          Onboarding checklist
        </h2>
        <OnboardingChecklist charityEmail={email} />
      </section>
    </AnalyticsFrame>
  )
}
