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

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", claimId)
      .single();

    if (claimErr) return safeJson(res, 500, { ok: false, error: claimErr.message });
    if (!claim) return safeJson(res, 404, { ok: false, error: "Claim not found" });

    const { data: charity, error: charErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, self_submit_enabled")
      .eq("id", claim.charity_id)
      .single();

    if (charErr) return safeJson(res, 500, { ok: false, error: charErr.message });

    return safeJson(res, 200, { ok: true, claim, charity });
  } catch (err: any) {
    return safeJson(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
