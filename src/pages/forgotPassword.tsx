import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/reset-password`
    })
    if (resetError) { setError(resetError.message); setLoading(false) }
    else setSent(true)
  }

  if (sent) return (
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
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="text-4xl mb-4">✉️</div>
          <h2 className="text-xl font-bold text-brand-primary mb-2">Check your email</h2>
          <p className="text-gray-500 text-sm mb-6">
            We've sent a reset link to <strong>{email}</strong>. Click it to set a new password.
          </p>
          <Link to="/login" className="text-brand-accent text-sm font-medium hover:underline">← Back to sign in</Link>
        </div>
      </div>
    </div>
  )

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
          <h2 className="text-xl font-bold text-brand-primary mb-1">Forgot your password?</h2>
          <p className="text-sm text-gray-500 mb-6">Enter your email and we'll send you a reset link.</p>
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input type="email" required className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40"
                value={email} onChange={e => setEmail(e.target.value)} disabled={loading} autoComplete="email" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
          <p className="text-center mt-5">
            <Link to="/login" className="text-brand-accent text-sm font-medium hover:underline">← Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
