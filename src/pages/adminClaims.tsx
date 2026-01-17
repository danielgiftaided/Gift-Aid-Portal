import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useNavigate } from "react-router-dom";

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

type Charity = {
  id: string;
  name: string;
  contact_email: string;
  self_submit_enabled?: boolean;
};

const STATUSES = ["", "draft", "ready", "submitted", "accepted", "rejected", "failed"] as const;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");
  return token;
}

export default function AdminClaims() {
  const nav = useNavigate();

  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [charities, setCharities] = useState<Charity[]>([]);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null); // busy claim id for quick actions
  const [error, setError] = useState<string | null>(null);

  const [status, setStatus] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Create claim form
  const [charityId, setCharityId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [taxYear, setTaxYear] = useState<string>("");

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

  const loadCharities = async () => {
    const token = await getToken();
    const res = await fetch("/api/admin/charities/list?limit=200&offset=0", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load charities");
    setCharities(json.charities || []);
    // Default selection
    if (!charityId && (json.charities || []).length > 0) {
      setCharityId(json.charities[0].id);
    }
  };

  const loadClaims = async () => {
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
  };

  const loadAll = async () => {
    try {
      setLoading(true);
      setError(null);
      await Promise.all([loadCharities(), loadClaims()]);
    } catch (e: any) {
      setError(e.message || "Error");
      setClaims([]);
      setCharities([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const createClaim = async () => {
    try {
      setCreating(true);
      setError(null);

      if (!charityId) throw new Error("Please select a charity");
      if (!periodStart) throw new Error("Please choose a period start date");
      if (!periodEnd) throw new Error("Please choose a period end date");

      const token = await getToken();
      const res = await fetch("/api/admin/claims/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          charityId,
          periodStart,
          periodEnd,
          taxYear: taxYear || null,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to create claim");

      // Go straight to the claim detail page
      nav(`/admin/claims/${json.claim.id}`);
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setCreating(false);
    }
  };

  const quickMarkReady = async (id: string) => {
    try {
      setBusyId(id);
      setError(null);

      const token = await getToken();
      const res = await fetch("/api/admin/claims/mark-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claimId: id }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to mark ready");
      await loadClaims();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusyId(null);
    }
  };

  const quickSubmit = async (id: string) => {
    try {
      setBusyId(id);
      setError(null);

      const token = await getToken();
      const res = await fetch("/api/admin/claims/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claimId: id }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to submit claim");
      await loadClaims();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Operator Claims</h1>
          <p className="text-gray-600">Create claims, add items, mark ready, and submit to HMRC.</p>
        </div>
        <button
          onClick={loadAll}
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

      {/* Create Claim Panel */}
      <div className="bg-white rounded-lg shadow p-4 mb-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Create a new claim</h2>
          <Link to="/admin" className="text-sm text-blue-600 hover:underline">
            Admin home
          </Link>
        </div>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <label className="block text-xs text-gray-600 mb-1">Charity</label>
            <select
              className="border rounded px-2 py-2 text-sm w-full"
              value={charityId}
              onChange={(e) => setCharityId(e.target.value)}
              disabled={loading || creating}
            >
              {charities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Period start</label>
            <input
              type="date"
              className="border rounded px-2 py-2 text-sm w-full"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              disabled={loading || creating}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Period end</label>
            <input
              type="date"
              className="border rounded px-2 py-2 text-sm w-full"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              disabled={loading || creating}
            />
          </div>

          <div>
            <label className="block text-xs text-gray-600 mb-1">Tax year (optional)</label>
            <input
              className="border rounded px-2 py-2 text-sm w-full"
              placeholder="e.g. 2024-25"
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              disabled={loading || creating}
            />
          </div>
        </div>

        <div className="mt-3">
          <button
            onClick={createClaim}
            disabled={creating || loading || charities.length === 0}
            className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? "Creating…" : "Create Claim"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 flex flex-col md:flex-row gap-3 md:items-center md:justify-between">
        <div className="flex gap-3 items-center">
          <label className="text-sm text-gray-600">Status</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            disabled={loading}
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
            disabled={loading}
          />
        </div>
      </div>

      {/* Claims table */}
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
                  <td className="px-4 py-3 text-sm whitespace-nowrap">{c.hmrc_reference ?? "-"}</td>

                  <td className="px-4 py-3 text-sm whitespace-nowrap text-right space-x-3">
                    <Link className="text-blue-600 hover:underline" to={`/admin/claims/${c.id}`}>
                      Open
                    </Link>

                    {/* Quick actions (optional but helpful) */}
                    {c.status === "draft" && (
                      <button
                        onClick={() => quickMarkReady(c.id)}
                        disabled={busyId === c.id}
                        className="text-sm text-gray-700 hover:underline disabled:opacity-50"
                      >
                        {busyId === c.id ? "Working…" : "Mark Ready"}
                      </button>
                    )}

                    {c.status === "ready" && (
                      <button
                        onClick={() => quickSubmit(c.id)}
                        disabled={busyId === c.id}
                        className="text-sm text-blue-700 hover:underline disabled:opacity-50"
                      >
                        {busyId === c.id ? "Working…" : "Submit"}
                      </button>
                    )}
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
