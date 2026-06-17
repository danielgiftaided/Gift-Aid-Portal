import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { isPasswordPwned, stampPasswordChanged } from '../utils/hibp'

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

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"

async function redirectAfterReset(navigate: ReturnType<typeof useNavigate>) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) { navigate('/login'); return }
  const meResp = await fetch('/api/user/me', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
  const meJson = await meResp.json()
  if (!meResp.ok || !meJson.ok) { navigate('/login'); return }
  if (meJson.role === 'operator') { navigate('/admin'); return }
  if (!meJson.charityId) { navigate('/charity-setup'); return }
  navigate('/dashboard', { state: { charityName: meJson.charityName } })
}

export default function PasswordExpired() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true); setError(null)

    // HIBP check
    const pwned = await isPasswordPwned(password)
    if (pwned) {
      setError('This password has appeared in a data breach and cannot be used. Please choose a different password.')
      setLoading(false)
      return
    }

    const { error: updateErr } = await supabase.auth.updateUser({ password })
    if (updateErr) { setError(updateErr.message); setLoading(false); return }

    await stampPasswordChanged(supabase)
    await redirectAfterReset(navigate)
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
              <span className="text-lg">⏰</span>
              <h2 className="text-lg font-bold text-brand-primary">Time to update your password</h2>
            </div>
            <p className="text-xs text-gray-400 mb-5">
              Your password is over 180 days old. Please set a new one to continue — it only takes a moment.
            </p>

            {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">New password</label>
                <input type="password" required className={inputClass} value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters"
                  autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">Confirm new password</label>
                <input type="password" required className={inputClass} value={confirm}
                  onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
                {password && confirm && (
                  <p className={`text-xs mt-1 ${password === confirm ? 'text-green-600' : 'text-red-500'}`}>
                    {password === confirm ? 'Passwords match ✓' : 'Passwords do not match'}
                  </p>
                )}
              </div>
              <button type="submit" disabled={loading || !password || !confirm || password !== confirm}
                className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {loading ? 'Updating…' : 'Set new password and continue'}
              </button>
            </form>

            <div className="mt-5 bg-brand-surface rounded-lg p-3">
              <p className="text-xs text-gray-400 font-medium mb-1">Password requirements</p>
              <ul className="text-xs text-gray-400 space-y-0.5">
                <li>• At least 8 characters long</li>
                <li>• Must not appear in known data breaches</li>
                <li>• Must be different from your previous password</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
