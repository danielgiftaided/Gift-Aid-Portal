import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

type Charity = {
  id: string;
  name: string;
  contact_email: string;
  self_submit_enabled: boolean;
};

export default function Admin() {
  const [charities, setCharities] = useState<Charity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        setLoading(true);

        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;

        if (!token) {
          throw new Error("Not logged in. Please log in again.");
        }

        const res = await fetch("/api/admin/charities/list?limit=100&offset=0", {
          headers: { Authorization: `Bearer ${token}` },
        });

        const json = await res.json();

        if (!res.ok || !json.ok) {
          throw new Error(json?.error || "Failed to load charities");
        }

        setCharities(json.charities || []);
      } catch (e: any) {
        setError(e?.message || "Error loading admin data");
        setCharities([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Gift Aided Admin</h1>
          <p className="text-gray-600">Operator tools for managing charities and claims.</p>
        </div>

        <Link
          to="/admin/claims"
          className="inline-block px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          Manage Claims
        </Link>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Charities</h2>
          <span className="text-xs text-gray-500">
            {loading ? "Loading…" : `${charities.length} total`}
          </span>
        </div>

        {loading ? (
          <div className="text-gray-500">Loading charities…</div>
        ) : charities.length === 0 ? (
          <div className="text-gray-500">No charities found.</div>
        ) : (
          <ul className="divide-y">
            {charities.map((c) => (
              <li key={c.id} className="py-3">
                {/* Entire row clickable */}
                <Link
                  to={`/admin/charities/${c.id}`}
                  className="block rounded p-2 -m-2 hover:bg-gray-50"
                  title="Open charity details"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm text-gray-600">{c.contact_email}</div>

                      <div className="text-xs text-gray-400 mt-1">
                        ID: <span className="break-all">{c.id}</span>
                      </div>

                      <div className="text-xs text-gray-400">
                        Self submit enabled:{" "}
                        <span className="font-medium">
                          {c.self_submit_enabled ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <span className="text-sm text-blue-600 hover:underline">
                        View →
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
