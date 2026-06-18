import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body);
}

function parseBody(req: VercelRequest) {
  const b = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

function isAlphanumeric(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isDigit = c >= 48 && c <= 57;
    if (!isUpper && !isLower && !isDigit) return false;
  }
  return true;
}

function getTaxYearForDate(date: Date): string {
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  return (m > 4 || (m === 4 && d >= 6)) ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

function parseDonationDate(str: string | null): Date | null {
  if (!str) return null;
  const trimmed = str.trim();

  const dmy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10), year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const d = new Date(year, month - 1, day);
      if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d;
    }
  }

  const ymd = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const year = parseInt(ymd[1], 10), month = parseInt(ymd[2], 10), day = parseInt(ymd[3], 10);
    const d = new Date(year, month - 1, day);
    if (d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day) return d;
  }

  const fallback = new Date(trimmed);
  return isNaN(fallback.getTime()) ? null : fallback;
}

/**
 * Migrates any staged spreadsheet rows from pending_uploaded_records into the
 * charity's live submissions / donations / uploaded_records tables.
 * Runs silently — failure here should never block charity setup itself.
 */
async function migratePendingData(userEmail: string, charityId: string) {
  try {
    const normalisedEmail = userEmail.trim().toLowerCase();

    const { data: pendingRows } = await supabaseAdmin
      .from("pending_uploaded_records")
      .select("*")
      .eq("pending_email", normalisedEmail);

    if (!pendingRows || pendingRows.length === 0) {
      // Still mark the pending_charities row complete even with no data
      await supabaseAdmin
        .from("pending_charities")
        .update({ status: "completed", charity_id: charityId, completed_at: new Date().toISOString() })
        .eq("email", normalisedEmail);
      return;
    }

    const validRows = pendingRows.filter(r => r.record_status === "valid");

    // Group valid rows by tax year — one submission per tax year found
    const byTaxYear: Record<string, typeof validRows> = {};
    for (const row of validRows) {
      const ty = row.tax_year || getTaxYearForDate(parseDonationDate(row.donation_date) ?? new Date());
      if (!byTaxYear[ty]) byTaxYear[ty] = [];
      byTaxYear[ty].push(row);
    }

    // Map of pending row id -> created submission id (for valid rows only)
    const submissionIdByPendingRow: Record<string, string> = {};

    for (const [taxYear, rows] of Object.entries(byTaxYear)) {
      const totalDonations = rows.reduce((s, r) => s + (parseFloat(String(r.amount)) || 0), 0);
      const giftAid = Math.round(totalDonations * 0.25 * 100) / 100;

      const { data: newSub, error: subErr } = await supabaseAdmin
        .from("submissions")
        .insert({
          charity_id: charityId,
          submission_date: new Date().toISOString().split("T")[0],
          tax_year: taxYear,
          amount_claimed: giftAid,
          number_of_donations: rows.length,
          status: "pending",
        })
        .select("id")
        .single();

      if (subErr || !newSub) continue;

      for (const row of rows) submissionIdByPendingRow[row.id] = newSub.id;

      await supabaseAdmin.from("donations").insert(
        rows.map(r => ({
          submission_id: newSub.id,
          charity_id: charityId,
          title: r.title || null,
          first_name: r.first_name,
          last_name: r.last_name,
          address: r.address,
          postcode: r.postcode,
          donation_date: r.donation_date,
          amount: r.amount,
        }))
      );
    }

    // Insert ALL rows (valid, incomplete, opt_out) into uploaded_records for reporting
    await supabaseAdmin.from("uploaded_records").insert(
      pendingRows.map(r => ({
        charity_id: charityId,
        submission_id: submissionIdByPendingRow[r.id] ?? null,
        title: r.title || null,
        first_name: r.first_name,
        last_name: r.last_name,
        address: r.address,
        postcode: r.postcode,
        donation_date: r.donation_date,
        amount: r.amount,
        gift_aid_opt_in: r.gift_aid_opt_in,
        record_status: r.record_status,
        tax_year: r.tax_year || getTaxYearForDate(parseDonationDate(r.donation_date) ?? new Date()),
      }))
    );

    // Clean up the staged rows now that they're live
    await supabaseAdmin
      .from("pending_uploaded_records")
      .delete()
      .eq("pending_email", normalisedEmail);

    await supabaseAdmin
      .from("pending_charities")
      .update({ status: "completed", charity_id: charityId, completed_at: new Date().toISOString() })
      .eq("email", normalisedEmail);

  } catch (e) {
    console.error("migratePendingData failed:", e);
    // Never throw — charity setup must succeed regardless
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);
    const userId = user?.id;
    const userEmail = user?.email;
    if (!userId) {
      return send(res, 401, { ok: false, error: "Invalid session user" });
    }

    const body = parseBody(req);
    const name = String(body.name || "").trim();
    const contact_email = String(body.contact_email || "").trim();
    const charity_number = String(body.charity_number || "").trim().toUpperCase();

    if (!name) return send(res, 400, { ok: false, error: "Charity name is required" });
    if (!contact_email) return send(res, 400, { ok: false, error: "Contact email is required" });
    if (!charity_number) return send(res, 400, { ok: false, error: "Charity number is required" });
    if (charity_number.length < 3) return send(res, 400, { ok: false, error: "Charity number looks too short" });
    if (charity_number.length > 30) return send(res, 400, { ok: false, error: "Charity number looks too long" });
    if (!isAlphanumeric(charity_number)) {
      return send(res, 400, { ok: false, error: "Charity number must be letters and numbers only (no spaces or symbols)" });
    }

    const { data: existingUser, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .maybeSingle();

    if (userErr) return send(res, 500, { ok: false, error: userErr.message });
    if (!existingUser) {
      return send(res, 500, { ok: false, error: "User row not found. Please contact support." });
    }

    if (existingUser.charity_id) {
      return send(res, 200, { ok: true, charity_id: existingUser.charity_id, alreadySetup: true });
    }

    const { data: existingCharity, error: checkErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_id", charity_number)
      .maybeSingle();

    if (checkErr) return send(res, 500, { ok: false, error: checkErr.message });

    let charityId = existingCharity?.id ?? null;

    if (!charityId) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email,
          charity_id: charity_number,
          charity_number: charity_number,
          created_by: userId,
          self_submit_enabled: false,
        })
        .select("id")
        .single();

      if (createErr) return send(res, 500, { ok: false, error: createErr.message });
      if (!created?.id) return send(res, 500, { ok: false, error: "Charity created but no id returned" });

      charityId = created.id;
    }

    const { error: linkErr } = await supabaseAdmin
      .from("users")
      .update({ charity_id: charityId })
      .eq("id", userId);

    if (linkErr) return send(res, 500, { ok: false, error: linkErr.message });

    // ── Migrate any staged data waiting for this charity ──
    if (userEmail) {
      await migratePendingData(userEmail, charityId);
    }

    return send(res, 200, { ok: true, charity_id: charityId, alreadySetup: false });

  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
