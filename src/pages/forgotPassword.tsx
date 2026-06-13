import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'

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

const headingStyle = { fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '2rem', lineHeight: 1, display: 'block', marginBottom: '0.25rem' } as React.CSSProperties
const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setLoading(true); setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` })
    if (err) { setError(err.message); setLoading(false) } else setSent(true)
  }

  return (
    <div className="min-h-screen bg-brand-surface flex overflow-hidden relative">
      <AuthShapes />
      <div className="flex-1 flex flex-col justify-center px-8 sm:px-12 lg:px-20 py-12 relative" style={{ zIndex: 10 }}>
        <div className="max-w-sm w-full mx-auto lg:mx-0">
          <span style={headingStyle}>gift aided <span style={{ fontWeight: 400 }}>Portal</span></span>
          <p className="text-gray-400 text-sm mb-8">Helping charities claim what they are owed</p>
          {sent ? (
            <div className="bg-white rounded-2xl shadow-md p-7 text-center">
              <div className="text-4xl mb-3">✉️</div>
              <h2 className="text-lg font-bold text-brand-primary mb-2">Check your email</h2>
              <p className="text-sm text-gray-400 mb-5">We've sent a reset link to <strong className="text-gray-600">{email}</strong></p>
              <Link to="/login" className="text-brand-accent text-sm font-semibold hover:underline">← Back to sign in</Link>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-md p-7">
              <h2 className="text-lg font-bold text-brand-primary mb-0.5">Forgot your password?</h2>
              <p className="text-xs text-gray-400 mb-5">Enter your email and we'll send a reset link.</p>
              {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Email</label><input type="email" required className={inputClass} value={email} onChange={e => setEmail(e.target.value)} disabled={loading} /></div>
                <button type="submit" disabled={loading} className="w-full bg-brand-accent text-white rounded-lg px-4 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{loading ? 'Sending…' : 'Send reset link'}</button>
              </form>
              <p className="text-center mt-5"><Link to="/login" className="text-brand-accent text-xs font-semibold hover:underline">← Back to sign in</Link></p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
