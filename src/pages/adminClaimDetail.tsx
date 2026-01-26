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
  claim_id?: string;
  donor_title: string | null;
  donor_first_name: string;
  donor_last_name: string;
  donor_address: string;
  donor_postcode: string;
  donation_date: string;
  donation_amount: number;
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

/**
 * Minimal CSV parser:
 * - supports commas
 * - supports quoted values with commas: "10 Downing St, London"
 * - supports escaped quotes: ""
 * Returns array of objects keyed by header columns.
 */
function parseCsvToObjects(csv: string): Array<Record<string, string>> {
  const rows: string[][] = [];
  let cur = "";
  let inQuotes = false;
  let row: string[] = [];

  const pushCell = () => {
    row.push(cur);
    cur = "";
  };

  const pushRow = () => {
    // ignore completely empty lines
    if (row.length === 1 && row[0].trim() === "") {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];

    if (ch === '"') {
      const next = csv[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === ",") {
      pushCell();
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && csv[i + 1] === "\n") i++;
      pushCell();
      pushRow();
      continue;
    }

    cur += ch;
  }

  pushCell();
  pushRow();

  if (rows.length === 0) return [];

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1);

  const out: Array<Record<string, string>> = [];
  for (const r of dataRows) {
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = (r[i] ?? "").trim();
    }
    // skip blank lines (all fields empty)
    const anyValue = Object.values(obj).some((v) => v.trim() !== "");
    if (anyValue) out.push(obj);
  }
  return out;
}

/**
 * ✅ Safe HTML escaping WITHOUT replaceAll() (works on older TS targets)
 */
function escapeHtml(s: string) {
  return String(s ?? "")
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;")
    .split("'")
    .join("&#039;");
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

  // Add single item form fields (HMRC-aligned)
  const [title, setTitle] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [donationDate, setDonationDate] = useState("");
  const [donationAmount, setDonationAmount] = useState("");

  // Edit row state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editPostcode, setEditPostcode] = useState("");
  const [editDonationDate, setEditDonationDate] = useState("");
  const [editDonationAmount, setEditDonationAmount] = useState("");

  // CSV import state
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [csvRows, setCsvRows] = useState<
    Array<{
      title: string;
      first_name: string;
      last_name: string;
      address: string;
      postcode: string;
      donation_amount: string;
      donation_date: string;
    }>
  >([]);
  const [csvErrors, setCsvErrors] = useState<Array<{ row: number; error: string }>>([]);
  const [csvPreviewOpen, setCsvPreviewOpen] = useState(false);

  const computedTotal = useMemo(() => {
    return items.reduce((s, it) => s + Number(it.donation_amount || 0), 0);
  }, [items]);

  const canEditItems = claim?.status === "draft";

  const load = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!claimId) throw new Error("Missing claim id in URL");
      const token = await getToken();

      // 1) claim + charity
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

      // 2) claim items
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

  /**
   * ✅ NEW: Preview HMRC XML (calls admin endpoint with Bearer token)
   */
  const previewHmrcXml = async () => {
    try {
      setBusy("xml");
      setError(null);

      if (!claimId) throw new Error("Missing claim id in URL");

      const token = await getToken();

      const res = await fetch(
        `/api/admin/claims/xml?claimId=${encodeURIComponent(claimId)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const text = await res.text();

      if (!res.ok) {
        throw new Error(`XML preview failed (${res.status}): ${text.slice(0, 200)}`);
      }

      const w = window.open("", "_blank");
      if (!w) throw new Error("Popup blocked. Please allow popups and try again.");

      w.document.open();
      w.document.write(`
        <!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>HMRC XML Preview</title>
            <style>
              body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; padding: 16px; }
              pre { white-space: pre-wrap; word-break: break-word; background: #f7f7f7; padding: 12px; border-radius: 8px; border: 1px solid #e5e7eb; }
              .bar { display:flex; gap:10px; align-items:center; margin-bottom: 12px; }
              .muted { color:#6b7280; font-size:12px; }
              button { padding: 8px 10px; border:1px solid #e5e7eb; border-radius: 8px; background:white; cursor:pointer; }
              button:hover { background:#f9fafb; }
            </style>
          </head>
          <body>
            <div class="bar">
              <button id="copyBtn">Copy XML</button>
              <span class="muted">Claim: ${escapeHtml(claimId)}</span>
            </div>
            <pre id="xml">${escapeHtml(text)}</pre>
            <script>
              const copyBtn = document.getElementById('copyBtn');
              copyBtn.addEventListener('click', async () => {
                const xml = document.getElementById('xml').innerText;
                try {
                  await navigator.clipboard.writeText(xml);
                  copyBtn.innerText = 'Copied!';
                  setTimeout(() => copyBtn.innerText = 'Copy XML', 1200);
                } catch {
                  alert('Copy failed. You can select and copy manually.');
                }
              });
            </script>
          </body>
        </html>
      `);
      w.document.close();
    } catch (e: any) {
      setError(e?.message ?? "Failed to preview XML");
    } finally {
      setBusy(null);
    }
  };

  const addItem = async () => {
    try {
      setBusy("addItem");
      setError(null);

      if (!canEditItems) throw new Error("Items can only be added while claim is draft");

      if (!firstName.trim()) throw new Error("First Name is required");
      if (!lastName.trim()) throw new Error("Last Name is required");
      if (!address.trim()) throw new Error("Address is required");
      if (!postcode.trim()) throw new Error("Postcode is required");
      if (!donationDate) throw new Error("Donation Date is required");
      if (!donationAmount) throw new Error("Donation Amount is required");

      const amount = Number(donationAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Donation Amount must be a positive number");
      }

      const token = await getToken();

      const res = await fetch("/api/admin/claims/add-item", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          claimId,
          title: title.trim() || null,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          address: address.trim(),
          postcode: postcode.trim(),
          donationDate,
          donationAmount: amount,
        }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`add-item failed (${res.status}): ${(json?.error ?? text).slice(0, 160)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to add item");

      setTitle("");
      setFirstName("");
      setLastName("");
      setAddress("");
      setPostcode("");
      setDonationDate("");
      setDonationAmount("");
      await load();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (it: ClaimItem) => {
    setEditingId(it.id);
    setEditTitle(it.donor_title ?? "");
    setEditFirstName(it.donor_first_name ?? "");
    setEditLastName(it.donor_last_name ?? "");
    setEditAddress(it.donor_address ?? "");
    setEditPostcode(it.donor_postcode ?? "");
    setEditDonationDate(it.donation_date ?? "");
    setEditDonationAmount(String(it.donation_amount ?? ""));
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle("");
    setEditFirstName("");
    setEditLastName("");
    setEditAddress("");
    setEditPostcode("");
    setEditDonationDate("");
    setEditDonationAmount("");
  };

  const saveEdit = async () => {
    try {
      if (!editingId) return;
      setBusy(`save:${editingId}`);
      setError(null);

      if (!canEditItems) throw new Error("Items can only be edited while claim is draft");

      if (!editFirstName.trim()) throw new Error("First Name is required");
      if (!editLastName.trim()) throw new Error("Last Name is required");
      if (!editAddress.trim()) throw new Error("Address is required");
      if (!editPostcode.trim()) throw new Error("Postcode is required");
      if (!editDonationDate) throw new Error("Donation Date is required");
      if (!editDonationAmount) throw new Error("Donation Amount is required");

      const amt = Number(editDonationAmount);
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Donation Amount must be a positive number");

      const token = await getToken();

      const res = await fetch("/api/admin/claims/update-item", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          itemId: editingId,
          title: editTitle.trim() || null,
          firstName: editFirstName.trim(),
          lastName: editLastName.trim(),
          address: editAddress.trim(),
          postcode: editPostcode.trim(),
          donationDate: editDonationDate,
          donationAmount: amt,
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ itemId }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`delete-item failed (${res.status}): ${(json?.error ?? text).slice(0, 160)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to delete item");

      if (editingId === itemId) cancelEdit();
      await load();
    } catch (e: any) {
      setError(e.message || "Error");
    } finally {
      setBusy(null);
    }
  };

  // ===== CSV import =====
  const onPickCsvFile = async (file: File | null) => {
    try {
      setCsvErrors([]);
      setError(null);

      if (!file) {
        setCsvFilename(null);
        setCsvRows([]);
        setCsvPreviewOpen(false);
        return;
      }

      const text = await file.text();
      const parsed = parseCsvToObjects(text);

      if (parsed.length === 0) throw new Error("CSV contains no rows (check header row and data).");

      const normKey = (k: string) =>
        k.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");

      const normalizeRow = (r: Record<string, string>) => {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(r)) map[normKey(k)] = (v ?? "").trim();

        return {
          title: map["title"] || "",
          first_name: map["first_name"] || map["firstname"] || "",
          last_name: map["last_name"] || map["lastname"] || "",
          address: map["address"] || "",
          postcode: map["postcode"] || map["post_code"] || "",
          donation_amount: map["donation_amount"] || map["amount"] || "",
          donation_date: map["donation_date"] || map["date"] || "",
        };
      };

      const normalized = parsed.map(normalizeRow);

      setCsvFilename(file.name);
      setCsvRows(normalized);
      setCsvPreviewOpen(true);
    } catch (e: any) {
      setCsvFilename(null);
      setCsvRows([]);
      setCsvPreviewOpen(false);
      setError(e?.message ?? "Failed to parse CSV");
    }
  };

  const importCsv = async () => {
    try {
      setBusy("importCsv");
      setError(null);
      setCsvErrors([]);

      if (!canEditItems) throw new Error("Can only import into a draft claim");
      if (csvRows.length === 0) throw new Error("No CSV rows to import");

      const token = await getToken();

      const res = await fetch("/api/admin/claims/import-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claimId, rows: csvRows }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`import-csv failed (${res.status}): ${(json?.error ?? text).slice(0, 200)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to import CSV");

      setCsvErrors(json.errors || []);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Import failed");
    } finally {
      setBusy(null);
    }
  };

  const markReady = async () => {
    try {
      setBusy("ready");
      setError(null);

      const token = await getToken();

      const res = await fetch("/api/admin/claims/mark-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claimId }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`mark-ready failed (${res.status}): ${(json?.error ?? text).slice(0, 200)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to mark ready");

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Mark ready failed");
    } finally {
      setBusy(null);
    }
  };

  const submitClaim = async () => {
    try {
      setBusy("submit");
      setError(null);

      const token = await getToken();

      const res = await fetch("/api/admin/claims/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ claimId }),
      });

      const { json, text } = await safeReadJson(res);

      if (!res.ok) {
        throw new Error(`submit failed (${res.status}): ${(json?.error ?? text).slice(0, 200)}`);
      }
      if (!json?.ok) throw new Error(json?.error || "Failed to submit claim");

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Submit failed");
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
          <div className="text-xs text-gray-400 mt-1 break-all">Charity ID: {claim?.charity_id}</div>
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

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={previewHmrcXml}
              disabled={busy !== null}
              className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              title="Generate and preview the HMRC XML for this claim (admin only)"
            >
              {busy === "xml" ? "Generating XML…" : "Preview HMRC XML"}
            </button>

            <button
              disabled={busy !== null || (claim?.status !== "draft" && claim?.status !== "ready")}
              onClick={markReady}
              className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              title="Recalculate totals and move claim to 'ready'"
            >
              {busy === "ready" ? "Marking…" : "Mark Ready"}
            </button>

            <button
              disabled={busy !== null || claim?.status !== "ready"}
              onClick={submitClaim}
              className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
              title="Submit this claim to HMRC"
            >
              {busy === "submit" ? "Submitting…" : "Submit to HMRC"}
            </button>
          </div>
        </div>
      </div>

      {/* Donation Items */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Donation Items</h2>
          <div className="text-sm text-gray-600">
            Count: <span className="font-medium">{items.length}</span> • Total:{" "}
            <span className="font-medium">£{computedTotal.toLocaleString()}</span>
          </div>
        </div>

        {/* CSV Import */}
        <div className="mt-4 border border-gray-200 rounded p-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">Import donations from CSV (Admin only)</div>
              <div className="text-xs text-gray-500 mt-1">
                Required columns: title, first_name, last_name, address, postcode, donation_amount, donation_date
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {canEditItems ? "Claim is draft ✅" : "Import disabled (claim not draft) ❗"}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={!canEditItems || busy !== null}
              onChange={(e) => onPickCsvFile(e.target.files?.[0] ?? null)}
            />

            {csvFilename && (
              <div className="text-sm text-gray-700">
                Selected: <span className="font-medium">{csvFilename}</span> • Rows:{" "}
                <span className="font-medium">{csvRows.length}</span>
              </div>
            )}

            <button
              onClick={importCsv}
              disabled={!canEditItems || busy !== null || csvRows.length === 0}
              className="px-3 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy === "importCsv" ? "Importing…" : "Import CSV"}
            </button>

            <button
              onClick={() => setCsvPreviewOpen((v) => !v)}
              disabled={csvRows.length === 0}
              className="px-3 py-2 text-sm rounded border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              {csvPreviewOpen ? "Hide Preview" : "Preview"}
            </button>
          </div>

          {csvPreviewOpen && csvRows.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-2 py-2 text-left">title</th>
                    <th className="px-2 py-2 text-left">first_name</th>
                    <th className="px-2 py-2 text-left">last_name</th>
                    <th className="px-2 py-2 text-left">address</th>
                    <th className="px-2 py-2 text-left">postcode</th>
                    <th className="px-2 py-2 text-left">donation_amount</th>
                    <th className="px-2 py-2 text-left">donation_date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {csvRows.slice(0, 5).map((r, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-2">{r.title || "-"}</td>
                      <td className="px-2 py-2">{r.first_name}</td>
                      <td className="px-2 py-2">{r.last_name}</td>
                      <td className="px-2 py-2">{r.address}</td>
                      <td className="px-2 py-2">{r.postcode}</td>
                      <td className="px-2 py-2">{r.donation_amount}</td>
                      <td className="px-2 py-2">{r.donation_date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {csvRows.length > 5 && (
                <div className="text-xs text-gray-500 mt-2">Showing first 5 rows only.</div>
              )}
            </div>
          )}

          {csvErrors.length > 0 && (
            <div className="mt-3 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded p-3">
              <div className="font-medium">Some rows were skipped:</div>
              <ul className="list-disc ml-5 mt-2 text-sm">
                {csvErrors.slice(0, 15).map((e, idx) => (
                  <li key={idx}>
                    Row {e.row}: {e.error}
                  </li>
                ))}
              </ul>
              {csvErrors.length > 15 && <div className="text-xs mt-2">Showing first 15 errors.</div>}
            </div>
          )}
        </div>

        {/* Add item form */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-8 gap-3">
          <input
            id="title"
            name="title"
            className="border rounded px-2 py-2 text-sm"
            placeholder="Title (e.g. Mr)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="honorific-prefix"
          />
          <input
            id="first-name"
            name="firstName"
            className="border rounded px-2 py-2 text-sm"
            placeholder="First Name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="given-name"
          />
          <input
            id="last-name"
            name="lastName"
            className="border rounded px-2 py-2 text-sm"
            placeholder="Last Name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="family-name"
          />
          <input
            id="address"
            name="address"
            className="border rounded px-2 py-2 text-sm md:col-span-2"
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            disabled={busy !== null || !canEditItems}
            autoComplete="street-address"
          />
          <input
            id="postcode"
            name="postcode"
            className="border rounded px-2 py-2 text-sm"
            placeholder="Postcode"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
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
              Items can only be added/edited/deleted/imported while the claim is in{" "}
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
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Title</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">First</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Address</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Postcode</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Donation Date</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
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
                            className="border rounded px-2 py-1 text-sm w-24"
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_title || "-"
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-40"
                            value={editFirstName}
                            onChange={(e) => setEditFirstName(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_first_name
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-40"
                            value={editLastName}
                            onChange={(e) => setEditLastName(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_last_name
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-full min-w-[260px]"
                            value={editAddress}
                            onChange={(e) => setEditAddress(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          it.donor_address
                        )}
                      </td>

                      <td className="px-3 py-2 text-sm">
                        {isEditing ? (
                          <input
                            className="border rounded px-2 py-1 text-sm w-32"
                            value={editPostcode}
                            onChange={(e) => setEditPostcode(e.target.value)}
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
                            className="border rounded px-2 py-1 text-sm w-40"
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
                            className="border rounded px-2 py-1 text-sm w-28"
                            value={editDonationAmount}
                            onChange={(e) => setEditDonationAmount(e.target.value)}
                            disabled={rowBusy || !canEditItems}
                          />
                        ) : (
                          `£${Number(it.donation_amount || 0).toLocaleString()}`
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

      {/* Helpful CSV template */}
      <div className="text-xs text-gray-500 mt-6">
        CSV template header:{" "}
        <span className="font-mono">
          title,first_name,last_name,address,postcode,donation_amount,donation_date
        </span>
      </div>
    </div>
  );
}
