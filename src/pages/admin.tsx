import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";

type Charity = { id: string; name: string; contact_email: string };

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

export default function Admin() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteSuccess, setInviteSuccess] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Not logged in.");
        const res = await fetch("/api/admin/charities/list?limit=100&offset=0", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load");
        setCharities(json.charities || []);
      } catch (e: any) { setError(e?.message); } finally { setLoading(false); }
    })();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true); setInviteError(null); setInviteSuccess(false);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Not logged in');
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || 'Failed to send invite');
      setInviteSuccess(true);
      setInviteEmail('');
      setTimeout(() => setInviteSuccess(false), 5000);
    } catch (e: any) { setInviteError(e.message); } finally { setInviting(false); }
  };

  return (
    <div className="min-h-screen bg-brand-surface relative overflow-hidden">
      <PageShapes />
      <div className="relative" style={{ zIndex: 10 }}>
        <nav className="bg-white border-b border-gray-100">
          <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
            <Logo />
            <button onClick={async () => { await supabase.auth.signOut(); navigate('/login') }} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Log Out</button>
          </div>
        </nav>

        <div className="max-w-4xl mx-auto px-6 pt-12 pb-4">
          <h1 className="text-3xl font-bold text-brand-primary">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">Manage charities and Gift Aid submissions</p>
        </div>

        <div className="max-w-4xl mx-auto px-6 pb-12">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>}

          {/* Invite a new charity user */}
          <div className="bg-white rounded-xl border-l-4 border-brand-accent border-t border-r border-b border-gray-100 shadow-sm p-6 mb-6">
            <h2 className="font-semibold text-brand-primary mb-1">Invite a Charity User</h2>
            <p className="text-xs text-gray-400 mb-4">They'll receive an email with a link to set their password and create their charity profile.</p>
            <form onSubmit={handleInvite} className="flex gap-3 items-start">
              <input
                type="email" required placeholder="charity@example.com"
                value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/30 focus:border-brand-accent"
              />
              <button
                type="submit" disabled={inviting || !inviteEmail}
                className="bg-brand-accent text-white rounded-lg px-5 py-2.5 text-sm font-semibold hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {inviting ? 'Sending…' : 'Send Invite'}
              </button>
            </form>
            {inviteSuccess && <p className="text-sm text-green-600 mt-3">✓ Invite sent successfully</p>}
            {inviteError && <p className="text-sm text-red-500 mt-3">{inviteError}</p>}
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-brand-primary">Charities</h2>
              <span className="text-xs text-gray-400">{loading ? 'Loading…' : `${charities.length} total`}</span>
            </div>
            {loading ? (
              <div className="px-6 py-10 text-center text-gray-300">Loading charities…</div>
            ) : charities.length === 0 ? (
              <div className="px-6 py-10 text-center text-gray-300">No charities found.</div>
            ) : (
              <ul className="divide-y divide-gray-50">
                {charities.map(c => (
                  <li key={c.id}>
                    <div className="px-6 py-4 flex items-center justify-between hover:bg-brand-surface/40 transition-colors">
                      <div>
                        <div className="font-semibold text-brand-primary">{c.name}</div>
                        <div className="text-sm text-gray-400 mt-0.5">{c.contact_email}</div>
                      </div>
                      <Link to={`/admin/charities/${c.id}`}
                        className="px-4 py-1.5 text-sm font-semibold rounded-lg border border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white transition-colors">
                        View
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
