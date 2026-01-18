import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function json(res: VercelResponse, status: number, payload: any) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(payload));
}

function parseBody(req: VercelRequest): any {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const body = parseBody(req);
    const {
      itemId,
      donorName,
      donorPostcode,
      donationDate,
      donationAmount,
      declarationDate,
    } = body;

    if (!itemId) return json(res, 400, { ok: false, error: "itemId is required" });

    // Validate fields (simple, keep it safe)
    if (!donorName || !donorPostcode || !donationDate) {
      return json(res, 400, { ok: false, error: "donorName, donorPostcode, donationDate are required" });
    }

    const amt = Number(donationAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return json(res, 400, { ok: false, error: "donationAmount must be a positive number" });
    }

    // Update item.
    // NOTE: Your DB trigger will block updates unless the claim is still in 'draft'.
    const { data, error } = await supabaseAdmin
      .from("claim_items")
      .update({
        donor_name: String(donorName).trim(),
        donor_postcode: String(donorPostcode).trim(),
        donation_date: donationDate,
        donation_amount: amt,
        gift_aid_declaration_date: declarationDate || null,
      })
      .eq("id", itemId)
      .select("*")
      .single();

    if (error) return json(res, 500, { ok: false, error: error.message });

    return json(res, 200, { ok: true, item: data });
  } catch (err: any) {
    return json(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
