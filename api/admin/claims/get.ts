import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    await requireOperator(req);

    const claimId = typeof req.query.claimId === "string" ? req.query.claimId : "";
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("*")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: "Claim not found" });

    const { data: charity, error: charErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, self_submit_enabled")
      .eq("id", claim.charity_id)
      .single();

    if (charErr) return res.status(500).json({ ok: false, error: charErr.message });

    return res.status(200).json({ ok: true, claim, charity });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
