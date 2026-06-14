import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface Profile { name: string; contact_email: string; description: string; charity_number: string; authorised_official_name: string; authorised_official_role: string; address: string }
const empty: Profile = { name:'', contact_email:'', description:'', charity_number:'', authorised_official_name:'', authorised_official_role:'', address:'' }

function Logo() {
  return (
    <span style={{ fontFamily: "'Poppins', sans-serif", fontWeight: 800, color: '#0c745d', fontSize: '1.6rem', lineHeight: 1 }}>
      gift aided <span style={{ fontWeight: 400 }}>Portal</span>
    </span>
  )
}

function PageShapes() {
  return (
    <div className="absolute right-0 top-0 pointer-events-none select-none" style={{ zIndex: 0, width: '420px', height: '600px' }}>
      <div style={{ position: 'absolute', left: '242px', top: '30px',  width: '136px', height: '142px', background: '#304675', borderTopRightRadius: '100%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '187px', width: '136px', height: '266px', background: '#0c745d' }} />
      <div style={{ position: 'absolute', left: '134px', top: '76px',  width: '97px',  height: '96px',  background: '#e8e4db', borderRadius: '50% 50% 0 50%' }} />
      <div style={{ position: 'absolute', left: '242px', top: '468px', width: '97px',  height: '97px',  background: '#e8e4db', borderRadius: '0 50% 50% 50%' }} />
    </div>
  )
}

export default function CharityProfile() {
  const navigate = useNavigate()
  const [profile, setProfile] = useState<Profile>(empty)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { navigate('/login'); return }
      const res = await fetch('/api/charity/profile', { headers: { Authorization: `Bearer ${session.access_token}` }, cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setProfile(json.profile)
      setLoading(false)
    })()
  }, [])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setSaveSuccess(false); setSaveError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Not logged in')
      const res = await fetch('/api/charity/profile', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(profile) })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error || 'Failed to save')
      setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 4000)
    } catch (e: any) { setSaveError(e.message) } finally { setSaving(false) }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault(); setPasswordError(null); setPasswordSuccess(false)
    if (newPassword.length < 8) { setPasswordError('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    setPasswordSaving(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) setPasswordError(error.message)
    else { setPasswordSuccess(true); setNewPassword(''); setConfirmPassword(''); setTimeout(() => setPasswordSuccess(false), 4000) }
    setPasswordSaving(false)
  }

  const set = (field: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setProfile(prev => ({ ...prev, [field]: e.target.value }))
  const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><p className="text-brand-accent font-medium">Loading…</p></div>

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
            <Logo />
            <div className="flex items-center gap-5">
              <button onClick={() => navigate('/insights')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">Insights</button>
              <button onClick={() => navigate('/profile')} className="text-sm font-medium text-brand-primary hover:text-brand-accent transition-colors">My Profile</button>
              <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
            </div>
          </div>
        </nav>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-4">
          <h1 className="text-3xl font-bold text-brand-primary">Charity Profile</h1>
          <p className="text-gray-400 text-sm mt-1">Manage your organisation details and account settings</p>
        </div>

        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <button onClick={() => navigate('/dashboard')} className="text-sm font-medium text-brand-accent hover:underline mb-6 inline-block">← Back to dashboard</button>

          <form onSubmit={handleSave} className="space-y-4">
            <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
              <h3 className="font-semibold text-brand-primary mb-4">Organisation Details</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Charity Name <span className="text-red-400">*</span></label><input type="text" required className={inputClass} value={profile.name} onChange={set('name')} /></div>
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Charity Number</label><input type="text" className={inputClass} value={profile.charity_number} onChange={set('charity_number')} placeholder="e.g. 328158" /></div>
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Contact Email</label><input type="email" className={inputClass} value={profile.contact_email} onChange={set('contact_email')} /></div>
                <div className="sm:col-span-2"><label className="block text-sm font-medium text-gray-600 mb-1">Description</label><textarea rows={3} className={`${inputClass} resize-none`} value={profile.description} onChange={set('description')} placeholder="A short description of your charity's work…" /></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
              <h3 className="font-semibold text-brand-primary mb-1">Authorised Official</h3>
              <p className="text-xs text-gray-400 mb-4">The person authorised to claim Gift Aid with HMRC on your charity's behalf.</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Full Name</label><input type="text" className={inputClass} value={profile.authorised_official_name} onChange={set('authorised_official_name')} placeholder="e.g. Jane Smith" /></div>
                <div><label className="block text-sm font-medium text-gray-600 mb-1">Role / Job Title</label><input type="text" className={inputClass} value={profile.authorised_official_role} onChange={set('authorised_official_role')} placeholder="e.g. Treasurer" /></div>
              </div>
            </div>

            <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
              <h3 className="font-semibold text-brand-primary mb-4">Correspondence Address</h3>
              <textarea rows={3} className={`${inputClass} resize-none`} value={profile.address} onChange={set('address')} placeholder="Street address, town, postcode" />
            </div>

            {saveError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{saveError}</div>}
            {saveSuccess && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">Profile saved successfully.</div>}
            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="bg-brand-accent text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>

          <form onSubmit={handlePasswordChange} className="mt-4">
            <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6">
              <h3 className="font-semibold text-brand-primary mb-4">Change Password</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div><label className="block text-sm font-medium text-gray-600 mb-1">New Password</label><input type="password" className={inputClass} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 mb-1">Confirm Password</label>
                  <input type="password" className={inputClass} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                  {newPassword && confirmPassword && <p className={`text-xs mt-1 ${newPassword === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>{newPassword === confirmPassword ? 'Passwords match ✓' : 'Passwords do not match'}</p>}
                </div>
              </div>
              {passwordError && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{passwordError}</div>}
              {passwordSuccess && <div className="mt-3 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">Password updated successfully.</div>}
              <div className="flex justify-end mt-4">
                <button type="submit" disabled={passwordSaving || !newPassword || !confirmPassword} className="bg-brand-accent text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{passwordSaving ? 'Updating…' : 'Update password'}</button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
