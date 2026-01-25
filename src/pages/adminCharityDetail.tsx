import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router-dom";

type Charity = {
  id: string;
  name: string;
  contact_email: string;
  charity_number: string; // ✅ HMRC CHARID stored here
  self_submit_enabled?: boolean;
};

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not logged in");
  return token;
}

export default function AdminCharityDetail() {
  const { id } = useParams();
  const charityUuid = id ?? "";

  const [charity, setCharity] = useState<Charity | null>(null);
  const [charityNumber, setCharityNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!charityUuid) throw new Error("Missing charity id in URL");

      const token = await getToken();

      const res = await fetch(
        `/api/admin/charities/get?charityId=${encodeURIComponent(charityUuid)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to load charity");

      setCharity(json.charity);
      setCharityNumber(json.charity?.charity_number ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Error");
      setCharity(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charityUuid]);

  const saveCharityNumber = async () => {
    try {
      setBusy("save");
      setError(null);

      const token = await getToken();

      const res = await fetch("/api/admin/charities/update-number", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          charityId: charityUuid,
          charityNumber: charityNumber, // ✅ matches handler (also accepts charity_number / hmrcCharId)
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json?.error || "Failed to update charity number");

      // ✅ update UI from response
      setCharity(json.charity);
      setCharityNumber(json.charity?.charity_number ?? "");
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="max-w-4xl mx-auto p-6 text-gray-500">Loading charity…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-4">
        <div className="text-sm text-gray-500">
          <Link to="/admin" className="text-blue-600 hover:underline">
            Admin
          </Link>{" "}
          / Charity Detail
        </div>
        <h1 className="text-2xl font-bold mt-1">{charity?.name ?? "Charity"}</h1>
        <div className="text-xs text-gray-400 break-all">{charityUuid}</div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-6">
        <div className="text-sm text-gray-600">Contact email</div>
        <div className="font-medium mb-4">{charity?.contact_email ?? "-"}</div>

        <h2 className="text-lg font-semibold mb-2">HMRC Settings</h2>
        <p className="text-sm text-gray-600 mb-3">
          Charity number is used as the HMRC CHARID in Gift Aid XML submissions.
          Only operators can edit this.
        </p>

        <label className="block text-sm font-medium mb-1">Charity number (HMRC CHARID)</label>
        <div className="flex flex-col md:flex-row gap-3">
          <input
            className="border rounded px-3 py-2 text-sm w-full md:max-w-md"
            value={charityNumber}
            onChange={(e) => setCharityNumber(e.target.value)}
            placeholder="e.g. AA12345 or 328158"
            autoComplete="off"
            disabled={busy !== null}
          />
          <button
            onClick={saveCharityNumber}
            disabled={busy !== null}
            className="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        </div>

        {charity?.charity_number && (
          <div className="text-xs text-gray-500 mt-2">
            Current saved charity number:{" "}
            <span className="font-medium">{charity.charity_number}</span>
          </div>
        )}

        <div className="mt-6 flex gap-3">
          <button
            onClick={load}
            className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50"
          >
            Refresh
          </button>

          <Link
            to={`/admin/claims?charityId=${encodeURIComponent(charityUuid)}`}
            className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50"
          >
            View Claims
          </Link>
        </div>
      </div>
    </div>
  );
}
