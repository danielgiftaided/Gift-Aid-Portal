import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";

/* =======================
   Types
======================= */

type Charity = {
  id: string;
  name: string;
  contact_email: string;
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
  status: "draft" | "ready" | "submitted" | string;
  hmrc_reference: string | null;
  hmrc_last_message: string | null;
};

type ClaimItem = {
  id: string;
  donor_name: string;
  donor_postcode: string;
  donation_date: string;
  donation_amount: number;
  gift_aid_declaration_date: string | null;
  created_at: string;
};

/* =======================
   Helpers
======================= */

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

/* =======================
   Component
======================= */

export default function AdminClaimDetail() {
  const { id } = useParams();
  const claimId = id ?? "";

  const [claim, setClaim] = useState<Claim | null>(null);
  const [charity, setCharity] = useState<Charity | null>(null);
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* Form state */
  const [donorName, setDonorName] = useState("");
  const [donorPostcode, setDonorPostcode] = useState("");
  const [donationDate, setDonationDate] = useState("");
  const [donationAmount, setDonationAmount] = useState("");
  const [declarationDate, setDeclarationDate] = useState("");

  const computedTotal = useMemo(
    () => items.reduce((sum, i) => sum + Number(i.donation_amount || 0), 0),
    [items]
  );

  /* =======================
     Load claim + items
  ======================= */

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!claimId) throw new Error("Missing claim id");

      const token = await getToken();

      /* Claim + charity */
      const claimRes = await fetch(
        `/api/admin/claims/get?claimId=${encodeURIComponent(claimId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { json: claimJson, text: claimText } = await safeReadJson(claimRes);

      if (!claimRes.ok || !claimJson?.ok) {
        throw new Error(claimJson?.error || claimText);
      }

      setClaim(claimJson.claim);
      setCharity(claimJson.charity);

      /* Items */
      const itemsRes = await fetch(
        `/api/admin/claims/items?claimId=${encodeURIComponent(claimId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { json: itemsJson, text: itemsText } = await safeReadJson(itemsRes);

      if (!itemsRes.ok || !itemsJson?.ok) {
        throw new Error(itemsJson?.error || itemsText);
      }

      setItems(itemsJson.items || []);
    } catch (e: any) {
      setError(e.message || "Failed to load claim");
      setClaim(null);
      setCharity(null);
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claimId]);

  /* =======================
     Actions
  ======================= */

  const addItem = async () => {
    try {
      setBusy("add");
      setError(null);

      if (!donorName || !donorPostcode || !donationDate || !donationAmount) {
        throw new Error("All donation fields are required");
      }

      const token = await getToken();

      const res = await fetch("/api/admin/claims/add-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          claimId,
          donorName,
          donorPostcode,
          donationDate,
          donationAmount: Number(donationAmount),
          declarationDate: declarationDate || null,
        }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || text);
      }

      setDonorName("");
      setDonorPostcode("");
      setDonationDate("");
      setDonationAmount("");
      setDeclarationDate("");
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const markReady = async () => {
    try {
      setBusy("ready");
      setError(null);
      const token = await getToken();

      await fetch("/api/admin/claims/mark-ready", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ claimId }),
      });

      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const submitClaim = async () => {
    try {
      setBusy("submit");
      setError(null);
      const token = await getToken();

      await fetch("/api/admin/claims/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ claimId }),
      });

      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  /* =======================
     Render
  ======================= */

  if (loading) {
    return <div className="p-6 text-gray-500">Loading claim…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <Link to="/admin/claims" className="text-blue-600 text-sm hover:underline">
        ← Back to claims
      </Link>

      <h1 className="text-2xl font-bold mt-2 mb-4">Claim Detail</h1>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      <div className="bg-white rounded shadow p-4 mb-4">
        <div className="font-semibold">{charity?.name}</div>
        <div className="text-sm text-gray-600">{charity?.contact_email}</div>
        <div className="text-xs text-gray-400 mt-1">
          Status: <b>{claim?.status}</b>
        </div>
      </div>

      {/* Add donation item */}
      <div className="bg-white rounded shadow p-4 mb-4">
        <h2 className="font-semibold mb-2">Add Donation</h2>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <input id="donor-name" name="donorName" placeholder="Donor name" value={donorName}
            onChange={e => setDonorName(e.target.value)} className="border px-2 py-2 rounded" />

          <input id="donor-postcode" name="donorPostcode" placeholder="Postcode" value={donorPostcode}
            onChange={e => setDonorPostcode(e.target.value)} className="border px-2 py-2 rounded" />

          <input id="donation-date" name="donationDate" type="date" value={donationDate}
            onChange={e => setDonationDate(e.target.value)} className="border px-2 py-2 rounded" />

          <input id="donation-amount" name="donationAmount" placeholder="Amount" value={donationAmount}
            onChange={e => setDonationAmount(e.target.value)} className="border px-2 py-2 rounded" />

          <input id="declaration-date" name="declarationDate" type="date" value={declarationDate}
            onChange={e => setDeclarationDate(e.target.value)} className="border px-2 py-2 rounded" />
        </div>

        <button
          disabled={busy !== null || claim?.status !== "draft"}
          onClick={addItem}
          className="mt-3 px-3 py-2 text-sm border rounded hover:bg-gray-50 disabled:opacity-50"
        >
          Add item
        </button>
      </div>

      {/* Totals */}
      <div className="bg-white rounded shadow p-4 mb-4">
        Items: <b>{items.length}</b> • Total: <b>£{computedTotal.toLocaleString()}</b>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          disabled={claim?.status !== "draft"}
          onClick={markReady}
          className="px-3 py-2 border rounded"
        >
          Mark Ready
        </button>

        <button
          disabled={claim?.status !== "ready"}
          onClick={submitClaim}
          className="px-3 py-2 bg-blue-600 text-white rounded"
        >
          Submit to HMRC
        </button>
      </div>
    </div>
  );
}
