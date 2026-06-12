import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    supabase.auth.getSession().then(({ data: { session } }) => { if (session) setReady(true) })
    return () => subscription.unsubscribe()
  }, [])

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    if (updateError) { setError(updateError.message); setLoading(false) }
    else { await supabase.auth.signOut(); navigate('/login', { state: { message: 'Password updated successfully. Please sign in.' } }) }
  }

  return (
    <div className="min-h-screen bg-brand-surface flex flex-col">
      <div className="bg-brand-primary px-4 pt-10 pb-20 text-center flex-shrink-0">
        <div className="inline-flex items-center gap-2 mb-2">
          <div className="w-8 h-8 bg-brand-accent rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">GA</span>
          </div>
          <span className="text-white font-bold text-xl tracking-tight">Gift Aided Portal</span>
        </div>
      </div>
      <div className="max-w-md w-full mx-auto px-4 -mt-12 pb-10">
        <div className="bg-white rounded-2xl shadow-xl p-8">
          {!ready ? (
            <p className="text-gray-400 text-sm text-center">Verifying your reset link…</p>
          ) : (
            <>
              <h2 className="text-xl font-bold text-brand-primary mb-1">Set a new password</h2>
              <p className="text-sm text-gray-500 mb-6">Choose a strong password for your account.</p>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
              <form onSubmit={handleReset} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
                  <input type="password" required className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
                    value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirm password</label>
                  <input type="password" required className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
                    value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
                  {password && confirm && (
                    <p className={`text-xs mt-1 ${password === confirm ? 'text-green-600' : 'text-red-500'}`}>
                      {password === confirm ? 'Passwords match ✓' : 'Passwords do not match'}
                    </p>
                  )}
                </div>
                <button type="submit" disabled={loading || !password || !confirm || password !== confirm}
                  className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                  {loading ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
