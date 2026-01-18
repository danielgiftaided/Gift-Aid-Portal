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

    const donor_title = String(body.title || "").trim();
    const donor_first_name = String(body.firstName || "").trim();
    const donor_last_name = String(body.lastName || "").trim();
    const donor_address = String(body.address || "").trim();
    const donor_postcode = String(body.postcode || "").trim();

    const donation_date = String(body.donationDate || "").trim();
    const donation_amount = Number(body.donationAmount);

    if (!claimId) return json(res, 400, { ok: false, error: "claimId is required" });
    if (!donor_first_name) return json(res, 400, { ok: false, error: "First Name is required" });
    if (!donor_last_name) return json(res, 400, { ok: false, error: "Last Name is required" });
    if (!donor_address) return json(res, 400, { ok: false, error: "Address is required" });
    if (!donor_postcode) return json(res, 400, { ok: false, error: "Postcode is required" });
    if (!isIsoDate(donation_date)) return json(res, 400, { ok: false, error: "Donation Date must be YYYY-MM-DD" });
    if (!Number.isFinite(donation_amount) || donation_amount <= 0) {
      return json(res, 400, { ok: false, error: "Donation Amount must be a positive number" });
    }

    // Must be draft (optional but recommended)
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id,status")
      .eq("id", claimId)
      .single();

    if (claimErr) return json(res, 500, { ok: false, error: claimErr.message });
    if (!claim) return json(res, 404, { ok: false, error: "Claim not found" });
    if (claim.status !== "draft") return json(res, 400, { ok: false, error: "Can only add items to a draft claim" });

    const { data, error } = await supabaseAdmin
      .from("claim_items")
      .insert({
        claim_id: claimId,
        donor_title: donor_title || null,
        donor_first_name,
        donor_last_name,
        donor_address,
        donor_postcode,
        donation_date,
        donation_amount,
      })
      .select("*")
      .single();

    if (error) return json(res, 500, { ok: false, error: error.message });

    return json(res, 200, { ok: true, item: data });
  } catch (e: any) {
    return json(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
