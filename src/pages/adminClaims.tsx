import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link } from "react-router-dom";

type ClaimRow = {
  id: string;
  charity_id: string;
  charity_name: string;
  created_at: string;
  period_start: string;
  period_end: string;
  tax_year: string | null;
  total_amount: number;
  donation_count: number;
  status: string;
  hmrc_reference: string | null;
  hmrc_last_message: string | null;
};

const STATUSES = ["", "draft", "ready", "submitted", "accepted", "rejected", "failed"] as const;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");
  return token;
}

export default function AdminClaims() {
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return claims;
    return claims.filter(
      (c) =>
        c.charity_name.toLowerCase().includes(s) ||
        c.id.toLowerCase().includes(s) ||
        (c.hmrc_reference ?? "").toLowerCase().includes(s)
    );
  }, [claims, search]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = await getToken();
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("limit", "100");
      qs.set("offset", "0");

      const res = await fetch(`/api/admin/claims/list?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();

      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load claims");
      setClaims(json.claims || []);
    } catch (e: any) {
      setError(e.message || "Error");
      setClaims([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Operator Claims</h1>
          <p className="text-gray-600">Prepare, mark ready, and submit claims to HMRC.</p>
        </div>
        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex gap-3 items-center">
          <label className="text-sm text-gray-600">Status</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((st) => (
              <option key={st} value={st}>
                {st === "" ? "All" : st}
              </option>
            ))}
          </select>
        </div>

        <div className="flex gap-3 items-center">
          <label className="text-sm text-gray-600">Search</label>
          <input
            className="border rounded px-2 py-1 text-sm w-full md:w-80"
            placeholder="Charity name, claim id, HMRC ref..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Link
          to="/admin"
          className="text-sm text-blue-600 hover:underline"
          title="Back to admin home"
        >
          Admin home
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        {loading ? (
          <div className="p-6 text-gray-500">Loading claims…</div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-gray-500">No claims found.</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Charity</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Donations</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">HMRC Ref</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {new Date(c.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <div className="font-medium">{c.charity_name}</div>
                    <div className="text-xs text-gray-500 break-all">{c.id}</div>
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {new Date(c.period_start).toLocaleDateString()} –{" "}
                    {new Date(c.period_end).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">{c.donation_count}</td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap font-medium">
                    £{Number(c.total_amount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
                      {c.status}
                    </span>
                    {c.hmrc_last_message && (
                      <div className="text-xs text-gray-500 mt-1">{c.hmrc_last_message}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    {c.hmrc_reference ?? "-"}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap text-right">
                    <Link
                      className="text-blue-600 hover:underline"
                      to={`/admin/claims/${c.id}`}
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
