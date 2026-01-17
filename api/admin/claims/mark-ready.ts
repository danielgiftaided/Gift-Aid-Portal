import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const { claimId } = req.body ?? {};
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    // compute totals from claim_items
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("claim_items")
      .select("donation_amount")
      .eq("claim_id", claimId);

    if (itemsErr) return res.status(500).json({ ok: false, error: itemsErr.message });
    const donation_count = items?.length ?? 0;
    const total_amount = (items ?? []).reduce((s: number, it: any) => s + Number(it.donation_amount || 0), 0);

    if (donation_count === 0) return res.status(400).json({ ok: false, error: "No donations in this claim" });

    const { error } = await supabaseAdmin
      .from("claims")
      .update({ status: "ready", donation_count, total_amount })
      .eq("id", claimId);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
