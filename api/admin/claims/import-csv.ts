import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function json(res: VercelResponse, status: number, payload: any) {
  return res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(payload));
}

function parseBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

function isIsoDate(d: any) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const body = parseBody(req);
    const claimId = String(body.claimId || "");
    const rows = Array.isArray(body.rows) ? body.rows : [];

    if (!claimId) return json(res, 400, { ok: false, error: "claimId is required" });
    if (!Array.isArray(rows) || rows.length === 0) return json(res, 400, { ok: false, error: "rows[] is required" });

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, status")
      .eq("id", claimId)
      .single();

    if (claimErr) return json(res, 500, { ok: false, error: claimErr.message });
    if (!claim) return json(res, 404, { ok: false, error: "Claim not found" });
    if (claim.status !== "draft") return json(res, 400, { ok: false, error: "Can only import into a draft claim" });

    const errors: Array<{ row: number; error: string }> = [];
    const inserts: any[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};

      const donor_title = String(r.title || "").trim();
      const donor_first_name = String(r.first_name || "").trim();
      const donor_last_name = String(r.last_name || "").trim();
      const donor_address = String(r.address || "").trim();
      const donor_postcode = String(r.postcode || "").trim();

      const donation_date = String(r.donation_date || "").trim();
      const donation_amount = Number(r.donation_amount);

      if (!donor_first_name) { errors.push({ row: i + 2, error: "First Name is required" }); continue; }
      if (!donor_last_name) { errors.push({ row: i + 2, error: "Last Name is required" }); continue; }
      if (!donor_address) { errors.push({ row: i + 2, error: "Address is required" }); continue; }
      if (!donor_postcode) { errors.push({ row: i + 2, error: "Postcode is required" }); continue; }
      if (!isIsoDate(donation_date)) { errors.push({ row: i + 2, error: "Donation Date must be YYYY-MM-DD" }); continue; }
      if (!Number.isFinite(donation_amount) || donation_amount <= 0) {
        errors.push({ row: i + 2, error: "Donation Amount must be a positive number" });
        continue;
      }

      inserts.push({
        claim_id: claimId,
        donor_title: donor_title || null,
        donor_first_name,
        donor_last_name,
        donor_address,
        donor_postcode,
        donation_date,
        donation_amount,
      });
    }

    if (inserts.length === 0) return json(res, 200, { ok: true, inserted: 0, errors });

    const CHUNK = 500;
    let inserted = 0;

    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK);
      const { error: insErr } = await supabaseAdmin.from("claim_items").insert(chunk);
      if (insErr) return json(res, 500, { ok: false, error: insErr.message, inserted, errors });
      inserted += chunk.length;
    }

    return json(res, 200, { ok: true, inserted, errors });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
