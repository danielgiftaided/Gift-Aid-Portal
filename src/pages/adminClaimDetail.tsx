import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router-dom";

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

export default function AdminClaimDetail() {
  const { id } = useParams();
  const claimId = id ?? "";

  const [claim, setClaim] = useState<Claim | null>(null);
  const [charity, setCharity] = useState<Charity | null>(null);
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Add form fields
  const [donorName, setDonorName] = useState("");
  const [donorPostcode, setDonorPostcode] = useState("");
  const [donationDate, setDonationDate] = useState("");
  const [donationAmount, setDonationAmount] = useState("");
  const [declarationDate, setDeclarationDate] = useState("");

  // Edit state per row
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDonorName, setEditDonorName] = useState("");
  const [editDonorPostcode, setEditDonorPostcode] = useState("");
  const [editDonationDate, setEditDonationDate] = useState("");
  const [editDonationAmount, setEditDonationAmount] = useState("");
  const [editDeclarationDate, setEditDeclarationDate] = useState("");

  const computedTotal = useMemo(() => {
    return items.reduce((s, it) => s + Number(it.donation_amount || 0), 0);
  }, [items]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!claimId) throw new Error("Missing claim id in URL");

      const token = await getToken();

      // 1) Load claim + charity
      const claimRes = await fetch(
        `/api/admin/claims/get?claimId=${encodeURIComponent(claimId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { json: claimJson, text: claimText } = await safeReadJson(claimRes);

      if (!claimRes.ok) {
        throw new Error(`claims/get failed (${claimRes.status}): ${claimText.slice(0, 160)}`);
      }
      if (!claimJson?.ok) {
        throw new Error(claimJson?.error || "Failed to load claim");
      }

      setClaim(claimJson.claim as Claim);
      setCharity(claimJson.charity as Charity);

      // 2) Load claim items
      const itemsRes = await fetch(
        `/api/admin/claims/items?claimId=${encodeURIComponent(claimId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const { json: itemsJson, text: itemsText } = await safeReadJson(itemsRes);

      if (!itemsRes.ok) {
        throw new Error(`claims/items failed (${itemsRes.status}): ${itemsText.slice(0, 160)}`);
      }
      if (!itemsJson?.ok) {
        throw new Error(itemsJson?.error || "Failed to load claim items");
      }

      setItems((itemsJson.items || []) as ClaimItem[]);
    } catch (e: any) {
      setError(e.message || "Error");
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

  const canEditItems = claim?.status === "draft";

  const addItem = async () => {
    try {
      setBusy("addItem");
      setError(null);

      if (!donorName.trim()) throw new Error("Donor name is required");
      if (!donorPostcode.trim()) throw new Error("Donor postcode is required");
      if (!donationDate) throw new Error("Donation date is required");
      if (!donationAmount) throw new Error("Donation amount is required");

      const amount = Number(donationAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Donation amount must be a positive number");
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
          donorName: donorName.trim(),
          donorPostcode: donorPostcode.trim(),
          donationDate,
          donationAmount: amount,
          declarationDate: declarationDate || null,
        }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`add-item failed (${res.status}): ${(json?.error ?? text).slice(0, 160)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to add item");

      setDonorName("");
      setDonorPostcode("");
      setDonationDate("");
      setDonationAmount("");
      setDeclarationDate("");
      await load();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (it: ClaimItem) => {
    setEditingId(it.id);
    setEditDonorName(it.donor_name ?? "");
    setEditDonorPostcode(it.donor_postcode ?? "");
    setEditDonationDate(it.donation_date ?? "");
    setEditDonationAmount(String(it.donation_amount ?? ""));
    setEditDeclarationDate(it.gift_aid_declaration_date ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDonorName("");
    setEditDonorPostcode("");
    setEditDonationDate("");
    setEditDonationAmount("");
    setEditDeclarationDate("");
  };

  const saveEdit = async () => {
    try {
      if (!editingId) return;
      setBusy(`save:${editingId}`);
      setError(null);

      if (!canEditItems) throw new Error("Items can only be edited while claim is draft");

      if (!editDonorName.trim()) throw new Error("Donor name is required");
      if (!editDonorPostcode.trim()) throw new Error("Donor postcode is required");
      if (!editDonationDate) throw new Error("Donation date is required");
      if (!editDonationAmount) throw new Error("Donation amount is required");

      const amt = Number(editDonationAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Donation amount must be a positive number");

      const token = await getToken();

      const res = await fetch("/api/admin/claims/update-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          itemId: editingId,
          donorName: editDonorName.trim(),
          donorPostcode: editDonorPostcode.trim(),
          donationDate: editDonationDate,
          donationAmount: amt,
          declarationDate: editDeclarationDate || null,
        }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`update-item failed (${res.status}): ${(json?.error ?? text).slice(0, 160)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to update item");

      cancelEdit();
      await load();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  const deleteItem = async (itemId: string) => {
    try {
      const ok = window.confirm("Delete this donation item? This cannot be undone.");
      if (!ok) return;

      setBusy(`del:${itemId}`);
      setError(null);

      if (!canEditItems) throw new Error("Items can only be deleted while claim is draft");

      const token = await getToken();

      const res = await fetch("/api/admin/claims/delete-item", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ itemId }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`delete-item failed (${res.status}): ${(json?.error ?? text).slice(0, 160)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to delete item");

      // If we deleted the item being edited, exit edit mode
      if (editingId === itemId) cancelEdit();

      await load();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return <div className="max-w-5xl mx-auto p-6 text-gray-500">Loading claim…</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-sm text-gray-500">
            <Link to="/admin/claims" className="text-blue-600 hover:underline">
              Operator Claims
            </Link>{" "}
            / Claim Detail
          </div>
          <h1 className="text-2xl font-bold mt-1">Claim</h1>
          <div className="text-xs text-gray-500 break-all">{claimId}</div>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow p-4 md:col-span-2">
          <h2 className="font-semibold mb-2">Charity</h2>
          <div className="text-lg font-medium">{charity?.name ?? "Unknown Charity"}</div>
          <div className="text-sm text-gray-600">{charity?.contact_email ?? "-"}</div>
          <div className="text-xs text-gray-400 mt-1 break-all">
            Charity ID: {claim?.charity_id}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="font-semibold mb-2">Status</h2>
          <div className="text-sm">
            <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800">
              {claim?.status ?? "-"}
            </span>
          </div>

          {claim?.hmrc_last_message && (
            <div className="text-xs text-gray-500 mt-2">{claim.hmrc_last_message}</div>
          )}

          <div className="text-xs text-gray-500 mt-2">
            HMRC Ref: <span className="font-medium">{claim?.hmrc_reference ?? "-"}</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <h2 className="font-semibold mb-2">Donation Items</h2>
        <div className="text-sm text-gray-600 mb-3">
          Count: <span className="font-medium">{items.length}</span> • Total:{" "}
          <span className="font-medium">£{computedTotal.toLocaleString()}</span>
        </div>

        {/* Add item form */}
        <div className="mt-2 grid grid-cols-1 md:grid-cols-6 gap-3">
          <input
            id="donor-name"
            name="donorName"
            className="border rounded px-2 py-2 text-sm md:col-span-2"
            placeholder="Donor name"
            value={donorName}
            onChange={(e) => setDonorName(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="name"
          />
          <input
            id="donor-postcode"
            name="donorPostcode"
            className="border rounded px-2 py-2 text-sm"
            placeholder="Postcode"
            value={donorPostcode}
            onChange={(e) => setDonorPostcode(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="postal-code"
          />
          <input
            id="donation-date"
            name="donationDate"
            type="date"
            className="border rounded px-2 py-2 text-sm"
            value={donationDate}
            onChange={(e) => setDonationDate(e.target.value)}
            disabled={busy !== null || !canEditItems}
          />
          <input
            id="donation-amount"
            name="donationAmount"
            className="border rounded px-2 py-2 text-sm"
            placeholder="Amount"
            value={donationAmount}
            onChange={(e) => setDonationAmount(e.target.value)}
            disabled={busy !== null || !canEditItems}
          />
          <input
            id="declaration-date"
            name="declarationDate"
            type="date"
            className="border rounded px-2 py-2 text-sm"
            value={declarationDate}
            onChange={(e) => setDeclarationDate(e.target.value)}
            disabled={busy !== null || !canEditItems}
            title="Optional: Gift Aid declaration date"
          />
        </div>

        <div className="mt-3">
          <button
            onClick={addItem}
            disabled={busy !== null || !canEditItems}
            className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === "addItem" ? "Adding…" : "Add Donation Item"}
          </button>

          {!canEditItems && (
            <div className="text-xs text-gray-500 mt-2">
              Items can only be added/edited/deleted while the claim is in{" "}
              <span className="font-medium">draft</span>.
            </div>
          )}
        </div>

        {/* Items table */}
        <div className="mt-4 overflow-x-auto">
          {items.length === 0 ? (
            <div className="text-gray-500 py-4">No donation items yet.</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Donor</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Postcode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Donation Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Declaration Date</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>

              <tbody className="bg-white divide-y divide-gray-200">
                {items.map((it) => {
                  const isEditing = editingId === it.id;
                  const rowBusy = busy === `save:${it.id}` || busy === `del:${it.id}`;

                  return (
                    <tr key={it.id}>
                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-full"
                            value={editDonorName}
                            onChange={(e) => setEditDonorName(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_name
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-full"
                            value={editDonorPostcode}
                            onChange={(e) => setEditDonorPostcode(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_postcode
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            type="date"
                            className="border rounded px-2 py-1 text-sm w-full"
                            value={editDonationDate}
                            onChange={(e) => setEditDonationDate(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          new Date(it.donation_date).toLocaleDateString()
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm font-medium">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-full"
                            value={editDonationAmount}
                            onChange={(e) => setEditDonationAmount(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          `£${Number(it.donation_amount || 0).toLocaleString()}`
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            type="date"
                            className="border rounded px-2 py-1 text-sm w-full"
                            value={editDeclarationDate}
                            onChange={(e) => setEditDeclarationDate(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : it.gift_aid_declaration_date ? (
                          new Date(it.gift_aid_declaration_date).toLocaleDateString()
                        ) : (
                          "-"
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm whitespace-nowrap text-right space-x-2">
                        {isEditing ? (
                          <>
                            <button
                              onClick={saveEdit}
                              disabled={rowBusy || !canEditItems}
                              className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                            >
                              {busy === `save:${it.id}` ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={rowBusy}
                              className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(it)}
                              disabled={!canEditItems || editingId !== null || rowBusy}
                              className="px-2 py-1 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteItem(it.id)}
                              disabled={!canEditItems || editingId !== null || rowBusy}
                              className="px-2 py-1 text-sm rounded border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50"
                            >
                              {busy === `del:${it.id}` ? "Deleting…" : "Delete"}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
