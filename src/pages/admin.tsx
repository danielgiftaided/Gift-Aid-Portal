import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type Charity = { id: string; name: string; contact_email: string; self_submit_enabled: boolean };

export default function Admin() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Not logged in");

        const res = await fetch("/api/admin/charities/list?limit=100&offset=0", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load charities");

        setCharities(json.charities || []);
      } catch (e: any) {
        setError(e.message || "Error");
      }
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Gift Aided Admin</h1>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{error}</div>}

      <div className="bg-white rounded-lg shadow p-4">
        <h2 className="font-semibold mb-3">Charities</h2>
        {charities.length === 0 ? (
          <div className="text-gray-500">No charities found.</div>
        ) : (
          <ul className="divide-y">
            {charities.map((c) => (
              <li key={c.id} className="py-3">
                <div className="font-medium">{c.name}</div>
                <div className="text-sm text-gray-600">{c.contact_email}</div>
                <div className="text-xs text-gray-400">ID: {c.id}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
