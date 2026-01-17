import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const { claimId } = req.body ?? {};
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: "Claim not found" });
    if (claim.status !== "ready") return res.status(400).json({ ok: false, error: "Claim must be 'ready' to submit" });

    // TODO: plug in HMRC XML generation + transport here.
    // For now, mark as submitted to confirm operator flow end-to-end.
    const { error } = await supabaseAdmin
      .from("claims")
      .update({
        status: "submitted",
        hmrc_last_message: "Submitted by operator (HMRC transport not yet connected)",
      })
      .eq("id", claimId);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
