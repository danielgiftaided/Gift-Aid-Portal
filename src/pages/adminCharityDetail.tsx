import { useEffect, useState, useRef } from "react";
import { supabase } from "../lib/supabase";
import { useParams, useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";

interface Charity {
  id: string;
  name: string;
  contact_email: string;
  charity_number: string | null;
}

interface Submission {
  id: string;
  submission_date: string;
  status: string;
  hmrc_reference: string | null;
  amount_claimed: number;
  number_of_donations: number;
  tax_year: string;
}

interface DonorRow {
  rowNum: number;
  title: string;
  firstName: string;
  lastName: string;
  address: string;
  postcode: string;
  donationDate: string;
  amount: number;
}

interface ParseError {
  row: number;
  message: string;
}

function getTaxYearForDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  // UK tax year starts 6 April
  if (month > 4 || (month === 4 && day >= 6)) {
    return `${year}/${String(year + 1).slice(2)}`;
  }
  return `${year - 1}/${String(year).slice(2)}`;
}

function parseDonationDate(str: string): Date | null {
  // DD/MM/YYYY
  const dmy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return new Date(parseInt(dmy[3]), parseInt(dmy[2]) - 1, parseInt(dmy[1]));
  // YYYY-MM-DD
  const ymd = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) return new Date(parseInt(ymd[1]), parseInt(ymd[2]) - 1, parseInt(ymd[3]));
  // fallback
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

function getTaxYearFromDonations(rows: DonorRow[]): string {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const date = parseDonationDate(row.donationDate);
    if (date) {
      const ty = getTaxYearForDate(date);
      counts[ty] = (counts[ty] || 0) + 1;
    }
  }
  // Use the most common tax year across all donations
  let best = "";
  let max = 0;
  for (const [ty, count] of Object.entries(counts)) {
    if (count > max) { max = count; best = ty; }
  }
  // Fallback: current tax year if no dates could be parsed
  if (!best) {
    const now = new Date();
    best = getTaxYearForDate(now);
  }
  return best;
}

function getCurrentTaxYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (month > 4 || (month === 4 && day >= 6)) {
    return `${year}/${String(year + 1).slice(2)}`;
  }
  return `${year - 1}/${String(year).slice(2)}`;
}

function parseExcel(file: File): Promise<{ rows: DonorRow[]; errors: ParseError[] }> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array", cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: false,
          dateNF: "dd/mm/yyyy",
        });

        if (rawRows.length < 2) {
          resolve({ rows: [], errors: [{ row: 0, message: "The spreadsheet is empty or has no data rows." }] });
          return;
        }

        const headers = (rawRows[0] as any[]).map((h) => String(h || "").toLowerCase().trim());

        const col: Record<string, number> = {};
        headers.forEach((h, i) => {
          if (h === "title") col.title = i;
          if (["first name", "firstname", "first_name"].includes(h)) col.firstName = i;
          if (["last name", "lastname", "last_name", "surname"].includes(h)) col.lastName = i;
          if (h === "address") col.address = i;
          if (["postcode", "post code", "post_code"].includes(h)) col.postcode = i;
          if (["donation date", "donationdate", "donation_date", "date"].includes(h)) col.donationDate = i;
          if (["amount", "donation amount", "donation_amount"].includes(h)) col.amount = i;
        });

        const missingCols: string[] = [];
        if (col.firstName === undefined) missingCols.push("First Name");
        if (col.lastName === undefined) missingCols.push("Last Name");
        if (col.address === undefined) missingCols.push("Address");
        if (col.postcode === undefined) missingCols.push("Postcode");
        if (col.donationDate === undefined) missingCols.push("Donation Date");
        if (col.amount === undefined) missingCols.push("Amount");

        if (missingCols.length > 0) {
          resolve({
            rows: [],
            errors: [{ row: 0, message: `Missing required columns: ${missingCols.join(", ")}. Please check your spreadsheet headers match exactly.` }],
          });
          return;
        }

        const rows: DonorRow[] = [];
        const errors: ParseError[] = [];

        for (let i = 1; i < rawRows.length; i++) {
          const row = rawRows[i] as any[];
          const rowNum = i + 1;

          if (!row || row.every((c) => !c && c !== 0)) continue;

          const get = (c?: number) => (c !== undefined ? String(row[c] || "").trim() : "");

          const firstName = get(col.firstName);
          const lastName = get(col.lastName);
          const address = get(col.address);
          const postcode = get(col.postcode);
          const donationDate = get(col.donationDate);
          const amountRaw = col.amount !== undefined ? row[col.amount] : "";
          const amount = parseFloat(String(amountRaw).replace(/[£,\s]/g, ""));

          if (!firstName) errors.push({ row: rowNum, message: `Row ${rowNum}: First Name is required.` });
          if (!lastName) errors.push({ row: rowNum, message: `Row ${rowNum}: Last Name is required.` });
          if (!address) errors.push({ row: rowNum, message: `Row ${rowNum}: Address is required.` });
          if (!postcode) errors.push({ row: rowNum, message: `Row ${rowNum}: Postcode is required.` });
          if (!donationDate) errors.push({ row: rowNum, message: `Row ${rowNum}: Donation Date is required.` });
          if (!amountRaw && amountRaw !== 0) {
            errors.push({ row: rowNum, message: `Row ${rowNum}: Amount is required.` });
          } else if (isNaN(amount) || amount <= 0) {
            errors.push({ row: rowNum, message: `Row ${rowNum}: Amount must be a positive number (found "${amountRaw}").` });
          }

          rows.push({
            rowNum,
            title: get(col.title),
            firstName,
            lastName,
            address,
            postcode,
            donationDate,
            amount: isNaN(amount) ? 0 : amount,
          });
        }

        resolve({ rows, errors });
      } catch (err: any) {
        resolve({ rows: [], errors: [{ row: 0, message: `Could not read the file: ${err.message}` }] });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

export default function AdminCharityDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [charity, setCharity] = useState<Charity | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [parsedRows, setParsedRows] = useState<DonorRow[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    try {
      setPageError(null);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { navigate("/login"); return; }

      const { data: charityData, error: charityErr } = await supabase
        .from("charities")
        .select("id, name, contact_email, charity_number")
        .eq("id", id)
        .single();

      if (charityErr) throw new Error(charityErr.message);
      setCharity(charityData);

      const { data: subsData } = await supabase
        .from("submissions")
        .select("id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year")
        .eq("charity_id", id)
        .order("submission_date", { ascending: false });

      setSubmissions(subsData || []);
    } catch (e: any) {
      setPageError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsedRows([]);
    setParseErrors([]);
    setSubmitSuccess(false);
    setSubmitError(null);
    const result = await parseExcel(file);
    setParsedRows(result.rows);
    setParseErrors(result.errors);
  };

  const handleSubmit = async () => {
    if (parseErrors.length > 0 || parsedRows.length === 0) return;
    try {
      setSubmitting(true);
      setSubmitError(null);

      const totalDonations = parsedRows.reduce((s, r) => s + r.amount, 0);
      const giftAidAmount = Math.round(totalDonations * 0.25 * 100) / 100;
      const taxYear = getTaxYearFromDonations(parsedRows);

      const { data: newSubmission, error: insertErr } = await supabase
        .from("submissions")
        .insert({
          charity_id: id,
          submission_date: new Date().toISOString().split("T")[0],
          tax_year: taxYear,
          amount_claimed: giftAidAmount,
          number_of_donations: parsedRows.length,
          status: "pending",
        })
        .select("id")
        .single();

      if (insertErr) throw new Error(insertErr.message);

      // Save individual donation rows
      const donationRows = parsedRows.map(r => ({
        submission_id: newSubmission.id,
        charity_id: id,
        title: r.title || null,
        first_name: r.firstName,
        last_name: r.lastName,
        address: r.address,
        postcode: r.postcode,
        donation_date: r.donationDate,
        amount: r.amount,
      }));

      const { error: donationsErr } = await supabase
        .from("donations")
        .insert(donationRows);

      if (donationsErr) throw new Error(donationsErr.message);

      setSubmitSuccess(true);
      setParsedRows([]);
      setParseErrors([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await loadData();
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateStatus = async (submissionId: string, newStatus: string) => {
    setUpdatingId(submissionId);
    const { error } = await supabase
      .from("submissions")
      .update({ status: newStatus })
      .eq("id", submissionId);
    if (error) setPageError(error.message);
    else setSubmissions(prev => prev.map(s => s.id === submissionId ? { ...s, status: newStatus } : s));
    setUpdatingId(null);
  };

  const handleDelete = async (submissionId: string) => {
    if (!window.confirm("Are you sure you want to delete this submission? This cannot be undone.")) return;
    setDeletingId(submissionId);
    const { error } = await supabase
      .from("submissions")
      .delete()
      .eq("id", submissionId);
    if (error) setPageError(error.message);
    else setSubmissions(prev => prev.filter(s => s.id !== submissionId));
    setDeletingId(null);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved": return "bg-green-100 text-green-800";
      case "rejected": return "bg-red-100 text-red-800";
      case "submitted": return "bg-blue-100 text-blue-800";
      case "pending": return "bg-yellow-100 text-yellow-800";
      default: return "bg-gray-100 text-gray-800";
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  return (
    <div className="min-h-screen bg-brand-surface">
      <div className="max-w-4xl mx-auto p-6">

        <button onClick={() => navigate("/admin")} className="text-sm text-brand-primary hover:underline mb-4 inline-block">
          ← Back to Admin
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-brand-primary">{charity?.name}</h1>
          <p className="text-gray-600">{charity?.contact_email}</p>
          {charity?.charity_number && (
            <p className="text-sm text-gray-500 mt-1">Charity number: {charity.charity_number}</p>
          )}
        </div>

        {pageError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">{pageError}</div>
        )}

        {/* Summary cards */}
        {submissions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white/80 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Total Claimed</div>
              <div className="text-2xl font-bold text-blue-600">
                £{submissions.reduce((s, r) => s + (parseFloat(String(r.amount_claimed)) || 0), 0)
                  .toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-white/80 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Total Submissions</div>
              <div className="text-2xl font-bold text-gray-900">{submissions.length}</div>
            </div>
            <div className="bg-white/80 rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">Approved</div>
              <div className="text-2xl font-bold text-green-600">
                {submissions.filter(s => s.status === "approved").length}
              </div>
            </div>
          </div>
        )}

        {/* Submissions table */}
        <div className="bg-white/80 rounded-lg shadow mb-6">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-brand-primary">Submissions</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {["Date", "Tax Year", "Amount", "Donations", "Status", "HMRC Ref", "Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {submissions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">No submissions yet</td>
                  </tr>
                ) : submissions.map(s => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {new Date(s.submission_date).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{s.tax_year}</td>
                    <td className="px-4 py-3 text-sm font-medium whitespace-nowrap text-blue-600">
                      £{parseFloat(String(s.amount_claimed || 0)).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">{s.number_of_donations}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <select
                        value={s.status}
                        disabled={updatingId === s.id}
                        onChange={(e) => handleUpdateStatus(s.id, e.target.value)}
                        className={`text-xs font-semibold rounded px-2 py-1 border-0 cursor-pointer focus:ring-2 focus:ring-brand-primary ${getStatusColor(s.status)}`}
                      >
                        <option value="pending">Pending</option>
                        <option value="submitted">Submitted</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono whitespace-nowrap">
                      {s.hmrc_reference || "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(s.id)}
                        disabled={deletingId === s.id}
                        className="text-xs text-red-600 hover:text-red-800 font-medium disabled:opacity-40"
                      >
                        {deletingId === s.id ? "Deleting…" : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Upload section */}
        <div className="bg-white/80 rounded-lg shadow p-6">
          <h2 className="font-semibold text-brand-primary mb-1">Upload Donation Spreadsheet</h2>
          <p className="text-sm text-gray-500 mb-1">
            Upload an Excel file (.xlsx) containing donation data. The Gift Aid amount (25%) will be calculated automatically.
          </p>
          <p className="text-xs text-gray-400 mb-4">
            Required columns: <span className="font-medium">First Name, Last Name, Address, Postcode, Donation Date, Amount</span> — Optional: Title
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-brand-primary file:text-white hover:file:opacity-90 mb-4"
          />

          {/* Validation errors */}
          {parseErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
              <p className="font-medium text-red-700 mb-2">
                {parseErrors.length === 1 ? "1 error found" : `${parseErrors.length} errors found`} — please fix before submitting:
              </p>
              <ul className="space-y-1">
                {parseErrors.map((e, i) => (
                  <li key={i} className="text-sm text-red-600 flex gap-2">
                    <span>•</span><span>{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Valid data preview */}
          {parsedRows.length > 0 && parseErrors.length === 0 && (
            <div className="mb-4">
              <div className="bg-green-50 border border-green-200 rounded px-4 py-3 mb-3">
                <p className="text-sm text-green-700 font-medium">
                  {parsedRows.length} valid donation{parsedRows.length !== 1 ? "s" : ""} ready —
                  total donations: £{parsedRows.reduce((s, r) => s + r.amount, 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })},
                  Gift Aid claim: £{(parsedRows.reduce((s, r) => s + r.amount, 0) * 0.25).toLocaleString("en-GB", { minimumFractionDigits: 2 })}
                </p>
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {["Title", "First Name", "Last Name", "Address", "Postcode", "Date", "Amount"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedRows.slice(0, 5).map(r => (
                      <tr key={r.rowNum}>
                        <td className="px-3 py-2 text-gray-500">{r.title || "—"}</td>
                        <td className="px-3 py-2">{r.firstName}</td>
                        <td className="px-3 py-2">{r.lastName}</td>
                        <td className="px-3 py-2">{r.address}</td>
                        <td className="px-3 py-2">{r.postcode}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.donationDate}</td>
                        <td className="px-3 py-2 whitespace-nowrap">£{r.amount.toFixed(2)}</td>
                      </tr>
                    ))}
                    {parsedRows.length > 5 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-2 text-center text-gray-400 text-xs italic">
                          … and {parsedRows.length - 5} more row{parsedRows.length - 5 !== 1 ? "s" : ""}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {submitSuccess && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded mb-4">
              Submission created successfully and is now visible to the charity.
            </div>
          )}

          {submitError && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-4">
              {submitError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting || parsedRows.length === 0 || parseErrors.length > 0}
            className="bg-brand-primary text-white rounded px-5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {submitting ? "Creating submission…" : "Create Gift Aid Submission"}
          </button>
        </div>

      </div>
    </div>
  );
}
