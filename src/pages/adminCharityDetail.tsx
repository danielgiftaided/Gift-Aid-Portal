import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

type Charity = {
  id: string;
  name: string;
  contact_email: string;
  self_submit_enabled?: boolean;
};

type Claim = {
  id: string;
  charity_id: string;
  created_at: string;
  period_start: string;
  period_end: string;
  tax_year: string | null;
  total_amount: number;
  donation_count: number;
  status: string;
  hmrc_reference: string | null;
};

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");
  return token;
}

async function safeReadJson(res: Response) {
  const text = await res.text();
  try {
    return { json: JSON.parse(text), text };
  } catch {
    return { json: null, text };
  }
}

export default function AdminCharityDetail() {
  const { id } = useParams();
  const charityId = id ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [charity, setCharity] = useState<Charity | null>(null);
  const [totals, setTotals] = useState<{
    totalGiftAidableDonations: number;
    totalGiftAidClaimedBack: number;
    claimCount: number;
    submissionCount: number;
  } | null>(null);

  const [claims, setClaims] = useState<Claim[]>([]);

  const inProgressClaims = useMemo(
    () => claims.filter((c) => ["draft", "ready", "submitted", "pending"].includes(c.status)),
    [claims]
  );

  const completedClaims = useMemo(
    () => claims.filter((c) => !["draft", "ready", "submitted", "pending"].includes(c.status)),
    [claims]
  );

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!charityId) throw new Error("Missing charity id");

      const token = await getToken();

      // 1) charity + totals
      const aRes = await fetch(`/api/admin/charities/get?charityId=${encodeURIComponent(charityId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const { json: aJson, text: aText } = await safeReadJson(aRes);
      if (!aRes.ok || !aJson?.ok) throw new Error(aJson?.error || aText);

      setCharity(aJson.charity);
      setTotals(aJson.totals);

      // 2) claims list
      const cRes = await fetch(`/api/admin/charities/claims?charityId=${encodeURIComponent(charityId)}&limit=200&offset=0`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      const { json: cJson, text: cText } = await safeReadJson(cRes);
      if (!cRes.ok || !cJson?.ok) throw new Error(cJson?.error || cText);

      setClaims(cJson.claims || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load charity");
      setCharity(null);
      setTotals(null);
      setClaims([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charityId]);

  if (loading) {
    return <div className="max-w-6xl mx-auto p-6 text-gray-500">Loading charity…</div>;
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="text-sm text-gray-500 mb-2">
        <Link to="/admin" className="text-blue-600 hover:underline">Gift Aided Admin</Link> / Charity
      </div>

      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">{charity?.name ?? "Charity"}</h1>
          <div className="text-sm text-gray-600">{charity?.contact_email ?? "-"}</div>
          <div className="text-xs text-gray-400 break-all mt-1">ID: {charityId}</div>
        </div>

        <button
          onClick={load}
          className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded shadow p-4">
          <div className="text-sm text-gray-600">Gift-aidable donations</div>
          <div className="text-2xl font-bold">£{Number(totals?.totalGiftAidableDonations ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded shadow p-4">
          <div className="text-sm text-gray-600">Gift Aid claimed back (approved)</div>
          <div className="text-2xl font-bold">£{Number(totals?.totalGiftAidClaimedBack ?? 0).toLocaleString()}</div>
        </div>
        <div className="bg-white rounded shadow p-4">
          <div className="text-sm text-gray-600">Claims</div>
          <div className="text-2xl font-bold">{totals?.claimCount ?? claims.length}</div>
        </div>
        <div className="bg-white rounded shadow p-4">
          <div className="text-sm text-gray-600">Submissions</div>
          <div className="text-2xl font-bold">{totals?.submissionCount ?? 0}</div>
        </div>
      </div>

      {/* Claims in progress */}
      <div className="bg-white rounded shadow mb-6">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Claims in progress</h2>
          <div className="text-sm text-gray-600">{inProgressClaims.length} total</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Donations</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {inProgressClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No in-progress claims</td>
                </tr>
              ) : (
                inProgressClaims.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-4 text-sm">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm">
                      {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm">{c.donation_count}</td>
                    <td className="px-6 py-4 text-sm font-medium">£{Number(c.total_amount || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">{c.status}</td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        to={`/admin/claims/${c.id}`}
                        className="text-blue-600 hover:underline text-sm"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Completed claims */}
      <div className="bg-white rounded shadow">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Completed claims</h2>
          <div className="text-sm text-gray-600">{completedClaims.length} total</div>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Period</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">HMRC Ref</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {completedClaims.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-4 text-center text-gray-500">No completed claims</td>
                </tr>
              ) : (
                completedClaims.map((c) => (
                  <tr key={c.id}>
                    <td className="px-6 py-4 text-sm">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-sm">
                      {new Date(c.period_start).toLocaleDateString()} – {new Date(c.period_end).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm font-medium">£{Number(c.total_amount || 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-sm">{c.status}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{c.hmrc_reference || "-"}</td>
                    <td className="px-6 py-4 text-right">
                      <Link to={`/admin/claims/${c.id}`} className="text-blue-600 hover:underline text-sm">
                        Open
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
