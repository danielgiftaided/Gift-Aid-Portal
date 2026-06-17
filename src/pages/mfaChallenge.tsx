import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { daysSincePasswordChange, stampPasswordChanged, PASSWORD_EXPIRY_DAYS } from '../utils/hibp'

function AuthShapes() {
  return (
    <div className="absolute top-0 right-0 pointer-events-none select-none overflow-hidden w-56 h-full" style={{ zIndex: 0 }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '0 50% 50% 50%' }} />
    </div>
  )
}

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent tracking-widest text-center text-lg font-mono"

async function redirectAfterAuth(navigate: ReturnType<typeof useNavigate>) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { navigate('/login'); return }

  // ── Password age check ──────────────────────────────────
  const { data: { user } } = await supabase.auth.getUser()
  const days = daysSincePasswordChange(user)

  if (days === null) {
    // No timestamp yet — start the clock from today (grace period for existing users)
    await stampPasswordChanged(supabase)
  } else if (days > PASSWORD_EXPIRY_DAYS) {
    navigate('/password-expired')
    return
  }

  // ── Role-based redirect ─────────────────────────────────
  const meResp = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
  const meJson = await meResp.json()
  if (!meResp.ok || !meJson.ok) { navigate('/login'); return }
  if (meJson.role === 'operator') { navigate('/admin'); return }
  if (!meJson.charityId) { navigate('/charity-setup'); return }
  navigate('/dashboard', { state: { charityName: meJson.charityName } })
}

export default function MfaChallenge() {
  const navigate = useNavigate()
  const [factorId, setFactorId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors()
      if (error || !data.totp.length) { navigate('/login'); return }
      setFactorId(data.totp[0].id)
    })()
  }, [])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!factorId || code.length !== 6) return
    setLoading(true); setError(null)
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
      if (error) throw error
      await redirectAfterAuth(navigate)
    } catch (e: any) {
      setError(e.message === 'Invalid TOTP code entered' ? 'Incorrect code — check your app and try again' : e.message)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-surface flex overflow-hidden relative">
      <AuthShapes />
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 py-12 relative" style={{ zIndex: 10 }}>
        <div className="max-w-sm w-full mx-auto lg:mx-0">
          <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '2rem', lineHeight: 1, display: 'block', marginBottom: '0.25rem' }}>
            gift aided <span style={{ fontWeight: 400 }}>Portal</span>
          </span>
          <p className="text-gray-400 text-sm mb-8">Helping charities claim what they are owed</p>

          <div className="bg-white rounded-2xl shadow-md p-7">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">🔐</span>
              <h2 className="text-lg font-bold text-brand-primary">Two-factor authentication</h2>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Open your authenticator app and enter the 6-digit code for <strong>Gift Aided Portal</strong>.
            </p>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

            <form onSubmit={handleVerify} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1 text-center">Authentication code</label>
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                  className={inputClass} value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000" autoComplete="one-time-code" autoFocus />
              </div>
              <button type="submit" disabled={loading || code.length !== 6 || !factorId}
                className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {loading ? 'Verifying…' : 'Verify and sign in'}
              </button>
            </form>

            <p className="text-xs text-gray-400 mt-5 text-center">
              Can't access your app?{' '}
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
                className="text-brand-accent hover:underline">Sign out and try again</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
