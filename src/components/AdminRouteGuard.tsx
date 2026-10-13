import { useCallback, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  AccountVerificationError,
  verifyPortalProfile,
  type AdminLoginIntent,
} from '../utils/authNavigation'

export default function AdminRouteGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const requestVersion = useRef(0)
  const [allowed, setAllowed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(true)
  const check = useCallback(async () => {
    const version = ++requestVersion.current
    setChecking(true)
    setAllowed(false)
    setError(null)
    const intent: AdminLoginIntent = {
      adminLogin: true,
      adminReturnTo: location.pathname + location.search,
    }
    const signIn = (message?: string) => {
      if (version !== requestVersion.current) return
      navigate('/admin/login', {
        replace: true,
        state: { ...intent, error: message },
      })
    }
    try {
      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession()
      if (version !== requestVersion.current) return
      if (sessionError) {
        signIn('Your session could not be restored. Please sign in again.')
        return
      }
      if (!session) {
        signIn()
        return
      }
      const profile = await verifyPortalProfile(session.access_token)
      if (version !== requestVersion.current) return
      if (profile.role !== 'operator') {
        signIn(
          'Administrator access is required. Sign in with your operator account.',
        )
        return
      }
      const { data: aal, error: aalError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aalError) throw aalError
      if (!aal)
        throw new Error(
          'Could not verify your sign-in security level. Please try again.',
        )
      if (aal.currentLevel !== 'aal2') {
        navigate(aal.nextLevel === 'aal2' ? '/mfa-challenge' : '/mfa-setup', {
          replace: true,
          state: intent,
        })
        return
      }
      setAllowed(true)
    } catch (e: unknown) {
      if (version !== requestVersion.current) return
      if (
        e instanceof AccountVerificationError &&
        e.status === 401 &&
        /invalid session|not authenticated|session.*expired/i.test(e.message)
      ) {
        signIn('Your session has expired. Please sign in again.')
        return
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Could not verify administrator access.',
      )
    } finally {
      if (version === requestVersion.current) setChecking(false)
    }
  }, [location.pathname, location.search, navigate])
  useEffect(() => {
    void check()
    return () => {
      requestVersion.current++
    }
  }, [check])
  useEffect(() => {
    let pendingCheck: number | undefined
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        requestVersion.current++
        // Defer auth API calls until Supabase releases its event callback lock.
        setAllowed(false)
        window.clearTimeout(pendingCheck)
        pendingCheck = window.setTimeout(() => {
          void check()
        }, 0)
      }
      if (event === 'SIGNED_OUT') {
        requestVersion.current++
        setAllowed(false)
        navigate('/admin/login', {
          replace: true,
          state: {
            adminLogin: true,
            adminReturnTo: location.pathname + location.search,
          },
        })
      }
    })
    return () => {
      window.clearTimeout(pendingCheck)
      subscription.unsubscribe()
    }
  }, [check, location.pathname, location.search, navigate])
  if (checking)
    return (
      <div
        className="min-h-screen bg-brand-surface flex items-center justify-center"
        role="status"
      >
        Checking administrator access…
      </div>
    )
  if (error)
    return (
      <div className="min-h-screen bg-brand-surface flex items-center justify-center p-6">
        <div className="bg-white rounded-xl p-6 max-w-lg">
          <h1 className="text-xl font-semibold text-brand-primary mb-3">
            Could not verify administrator access
          </h1>
          <p role="alert" className="text-sm text-red-700 mb-5">
            {error}
          </p>
          <div className="flex gap-4">
            <button
              onClick={() => void check()}
              className="text-brand-accent font-semibold"
            >
              Try again
            </button>
            <button
              onClick={() =>
                navigate('/admin/login', {
                  state: {
                    adminLogin: true,
                    adminReturnTo: location.pathname + location.search,
                  },
                })
              }
              className="text-brand-primary"
            >
              Sign in with another account
            </button>
          </div>
        </div>
      </div>
    )
  return allowed ? <Outlet /> : null
}
