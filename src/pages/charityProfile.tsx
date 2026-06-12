import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'

interface Profile {
  name: string; contact_email: string; description: string
  charity_number: string; authorised_official_name: string
  authorised_official_role: string; address: string
}
const empty: Profile = { name:'', contact_email:'', description:'', charity_number:'', authorised_official_name:'', authorised_official_role:'', address:'' }

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

  const set = (field: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setProfile(prev => ({ ...prev, [field]: e.target.value }))

  const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/40 focus:border-brand-accent"

  if (loading) return <div className="min-h-screen bg-brand-surface flex items-center justify-center"><div className="text-brand-primary font-medium">Loading…</div></div>

  return (
    <div className="min-h-screen bg-brand-surface">
      {/* Block 1 — Navy nav */}
      <nav className="bg-brand-primary">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand-accent rounded-md flex items-center justify-center">
              <span className="text-white font-bold text-xs">GA</span>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Gift Aided Portal</span>
          </div>
          <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }}
            className="text-sm text-white/70 hover:text-white transition-colors">Log Out</button>
        </div>
      </nav>

      {/* Block 2 — Teal banner */}
      <div className="bg-brand-accent">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-2xl font-bold text-white">Charity Profile</h1>
          <p className="text-white/75 text-sm mt-1">Manage your organisation details and account settings</p>
        </div>
      </div>

      {/* Block 3 — Cream content */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button onClick={() => navigate('/dashboard')} className="text-brand-accent text-sm font-medium hover:underline mb-6 inline-block">
          ← Back to dashboard
        </button>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Organisation */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-brand-primary mb-4">Organisation Details</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charity Name <span className="text-red-400">*</span></label>
                <input type="text" required className={inputClass} value={profile.name} onChange={set('name')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Charity Number</label>
                <input type="text" className={inputClass} value={profile.charity_number} onChange={set('charity_number')} placeholder="e.g. 328158" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Email</label>
                <input type="email" className={inputClass} value={profile.contact_email} onChange={set('contact_email')} />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea rows={3} className={`${inputClass} resize-none`} value={profile.description} onChange={set('description')} placeholder="A short description of your charity's work…" />
              </div>
            </div>
          </div>

          {/* Authorised Official */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-brand-primary mb-1">Authorised Official</h3>
            <p className="text-xs text-gray-400 mb-4">The person authorised to claim Gift Aid with HMRC on your charity's behalf.</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input type="text" className={inputClass} value={profile.authorised_official_name} onChange={set('authorised_official_name')} placeholder="e.g. Jane Smith" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role / Job Title</label>
                <input type="text" className={inputClass} value={profile.authorised_official_role} onChange={set('authorised_official_role')} placeholder="e.g. Treasurer" />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-brand-primary mb-4">Correspondence Address</h3>
            <textarea rows={3} className={`${inputClass} resize-none`} value={profile.address} onChange={set('address')} placeholder="Street address, town, postcode" />
          </div>

          {saveError && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{saveError}</div>}
          {saveSuccess && <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">Profile saved successfully.</div>}

          <div className="flex justify-end">
            <button type="submit" disabled={saving}
              className="bg-brand-accent text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>

        {/* Password */}
        <form onSubmit={handlePasswordChange} className="mt-4">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-brand-primary mb-4">Change Password</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input type="password" className={inputClass} value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 8 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password</label>
                <input type="password" className={inputClass} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
                {newPassword && confirmPassword && (
                  <p className={`text-xs mt-1 ${newPassword === confirmPassword ? 'text-green-600' : 'text-red-500'}`}>
                    {newPassword === confirmPassword ? 'Passwords match ✓' : 'Passwords do not match'}
                  </p>
                )}
              </div>
            </div>
            {passwordError && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{passwordError}</div>}
            {passwordSuccess && <div className="mt-3 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">Password updated successfully.</div>}
            <div className="flex justify-end mt-4">
              <button type="submit" disabled={passwordSaving || !newPassword || !confirmPassword}
                className="bg-brand-accent text-white rounded-lg px-6 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {passwordSaving ? 'Updating…' : 'Update password'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
