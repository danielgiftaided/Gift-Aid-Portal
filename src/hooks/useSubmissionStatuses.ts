import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllRows } from '../utils/fetchAll'

type StatusRow = { id: string; status: string }

// Database events provide immediate updates; polling recovers missed events
// and works when Realtime has not yet been enabled on the deployment.
export function useSubmissionStatuses(
  field: 'charity_id' | 'id', value: string | undefined,
  onStatuses: (rows: StatusRow[]) => void,
) {
  const callback = useRef(onStatuses)
  callback.current = onStatuses
  useEffect(() => {
    if (!value) return
    let disposed = false
    let requestVersion = 0
    const refresh = async () => {
      const version = ++requestVersion
      try {
        const rows = await fetchAllRows<StatusRow>(() =>
          supabase.from('submissions').select('id, status').eq(field, value).order('id')
        )
        if (!disposed && version === requestVersion) callback.current(rows)
      } catch (error) { console.error('Unable to refresh submission statuses', error) }
    }
    const channel = supabase.channel(`submission-status:${field}:${value}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'submissions', filter: `${field}=eq.${value}`,
      }, () => { void refresh() })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refresh() })
    const onFocus = () => { void refresh() }
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 5000)
    window.addEventListener('focus', onFocus)
    void refresh()
    return () => {
      disposed = true
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      void supabase.removeChannel(channel)
    }
  }, [field, value])
}
