import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function CharityWorkspaceInvite({ charityId, charityName }: { charityId: string; charityName: string }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setMessage(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Please sign in again')
      const response = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ charity_id: charityId, email: email.trim() }),
      })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || 'Unable to send invitation')
      setMessage({ ok: true, text: `Invitation sent to ${email.trim()} for ${charityName}.` })
      setEmail('')
    } catch (error: any) {
      setMessage({ ok: false, text: error.message || 'Unable to send invitation' })
    } finally { setSending(false) }
  }

  return <section className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 mb-6">
    <h2 className="font-semibold text-brand-primary">Invite to this workspace</h2>
    <p className="text-sm text-gray-500 mt-1 mb-4">Invite a charity contact to access {charityName} and complete their setup.</p>
    <form onSubmit={sendInvite} className="flex flex-wrap items-end gap-3">
      <label className="flex-1 min-w-[200px] text-sm font-medium text-gray-600">
        Email address
        <input type="email" required autoComplete="email" value={email} disabled={sending}
          onChange={event => setEmail(event.target.value)}
          className="block mt-1 w-full border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-accent/30" />
      </label>
      <button type="submit" disabled={sending || !email.trim()} className="bg-brand-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50">{sending ? 'Sending…' : 'Send invitation'}</button>
    </form>
    {message && <p role={message.ok ? 'status' : 'alert'} className={`text-sm mt-3 ${message.ok ? 'text-green-700' : 'text-red-600'}`}>{message.text}</p>}
  </section>
}
