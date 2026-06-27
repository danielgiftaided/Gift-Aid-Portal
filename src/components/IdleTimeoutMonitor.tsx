/**
 * Mounted once at the top level of the app (see App.tsx) — monitors user
 * activity across the whole site and signs out automatically after a
 * period of inactivity, redirecting to login with an explanatory message.
 *
 * Deliberately a single always-mounted component rather than something
 * added to every individual page, since the app currently has many
 * independent page components with no shared layout wrapper — this avoids
 * duplicating timeout logic everywhere.
 *
 * Renders nothing — it's a pure side-effect component.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const IDLE_TIMEOUT_MINUTES = 30
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

export default function IdleTimeoutMonitor() {
  const navigate = useNavigate()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    async function handleTimeout() {
      // Only act if there's actually a session to expire — avoids
      // redirecting someone who's simply sitting on the login page itself.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      await supabase.auth.signOut()
      navigate('/login', { state: { message: 'You were signed out after a period of inactivity, for security.' } })
    }

    function resetTimer() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(handleTimeout, IDLE_TIMEOUT_MINUTES * 60 * 1000)
    }

    resetTimer()
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, resetTimer))

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, resetTimer))
    }
  }, [navigate])

  return null
}
