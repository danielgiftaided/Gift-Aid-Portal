import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

function AuthShapes() {
  return (
    <div className="absolute top-0 right-0 pointer-events-none select-none overflow-hidden w-56 h-full" style={{ zIndex: 0 }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
    </div>
  )
}

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"

export default function ResetPassword() {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false); const [ready, setReady] = useState(false); const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') setReady(true) })
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) setReady(true) })
    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { setError(err.message); setLoading(false) }
    else { await supabase.auth.signOut(); navigate('/login', { state: { message: 'Password updated. Please sign in.' } }) }
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
            {!ready ? <p className="text-sm text-gray-400 text-center py-4">Verifying your reset link…</p> : (
              <>
                <h2 className="text-lg font-bold text-brand-primary mb-0.5">Set a new password</h2>
                <p className="text-xs text-gray-400 mb-5">Choose a strong password for your account.</p>
                {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
                <form onSubmit={handleReset} className="space-y-4">
                  <div><label className="block text-sm font-medium text-gray-600 mb-1">New password</label><input type="password" required className={inputClass} value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" /></div>
                  <div>
                    <label className="block text-sm font-medium text-gray-600 mb-1">Confirm password</label>
                    <input type="password" required className={inputClass} value={confirm} onChange={e => setConfirm(e.target.value)} />
                    {password && confirm && <p className={`text-xs mt-1 ${password === confirm ? 'text-green-600' : 'text-red-500'}`}>{password === confirm ? 'Passwords match ✓' : 'Passwords do not match'}</p>}
                  </div>
                  <button type="submit" disabled={loading || !password || !confirm || password !== confirm} className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{loading ? 'Updating…' : 'Update password'}</button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
