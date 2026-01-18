import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function safeJson(res: VercelResponse, status: number, payload: any) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return safeJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const charityId = typeof req.query.charityId === "string" ? req.query.charityId : "";
    if (!charityId) return safeJson(res, 400, { ok: false, error: "charityId is required" });

    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);

    const { data: claims, error } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, period_start, period_end, tax_year, total_amount, donation_count, status, created_at, hmrc_reference")
      .eq("charity_id", charityId)
      .order("created_at", { ascending: false })
      .range(offset, offset + Math.max(1, limit) - 1);

    if (error) return safeJson(res, 500, { ok: false, error: error.message });

    return safeJson(res, 200, { ok: true, claims: claims ?? [] });
  } catch (err: any) {
    return safeJson(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
