import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";

type Charity = { id: string; name: string; contact_email: string; self_submit_enabled: boolean };

export default function Admin() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Not logged in.");
        const res = await fetch("/api/admin/charities/list?limit=100&offset=0", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load charities");
        setCharities(json.charities || []);
      } catch (e: any) { setError(e?.message); } finally { setLoading(false); }
    })();
  }, []);

  return (
    <div className="min-h-screen bg-brand-surface">
      {/* Block 1 — Navy nav */}
      <nav className="bg-brand-primary">
        <div className="max-w-4xl mx-auto px-6 py-4 flex justify-between items-center">
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
        <div className="max-w-4xl mx-auto px-6 py-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="text-white/75 text-sm mt-1">Manage charities and Gift Aid submissions</p>
          </div>
          <Link to="/admin/claims"
            className="px-4 py-2 text-sm font-semibold rounded-lg bg-white/15 text-white border border-white/30 hover:bg-white/25 transition-colors">
            Manage Claims
          </Link>
        </div>
      </div>

      {/* Block 3 — Cream content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">{error}</div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-brand-primary/5">
            <h2 className="font-semibold text-brand-primary">Charities</h2>
            <span className="text-xs text-gray-400">{loading ? 'Loading…' : `${charities.length} total`}</span>
          </div>

          {loading ? (
            <div className="px-6 py-10 text-center text-gray-400">Loading charities…</div>
          ) : charities.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">No charities found.</div>
          ) : (
            <ul className="divide-y divide-gray-50">
              {charities.map(c => (
                <li key={c.id}>
                  <div className="px-6 py-4 flex items-center justify-between hover:bg-brand-surface/40 transition-colors">
                    <div>
                      <div className="font-semibold text-brand-primary">{c.name}</div>
                      <div className="text-sm text-gray-500 mt-0.5">{c.contact_email}</div>
                    </div>
                    <Link to={`/admin/charities/${c.id}`}
                      className="px-4 py-1.5 text-sm font-medium rounded-lg border border-brand-primary/20 text-brand-primary hover:bg-brand-primary hover:text-white transition-colors">
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
  );
}
