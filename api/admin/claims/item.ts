import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function safeJson(res: VercelResponse, status: number, payload: any) {
  return res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return safeJson(res, 405, { ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const claimId = typeof req.query.claimId === "string" ? req.query.claimId : "";
    if (!claimId) return safeJson(res, 400, { ok: false, error: "claimId is required" });

    const { data: items, error } = await supabaseAdmin
      .from("claim_items")
      .select("id, donor_name, donor_postcode, donation_date, donation_amount, gift_aid_declaration_date, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false });

    if (error) return safeJson(res, 500, { ok: false, error: error.message });

    return safeJson(res, 200, { ok: true, items: items ?? [] });
  } catch (err: any) {
    return safeJson(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
