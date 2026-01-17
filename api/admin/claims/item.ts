import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    await requireOperator(req);

    const claimId = typeof req.query.claimId === "string" ? req.query.claimId : "";
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    const { data: items, error } = await supabaseAdmin
      .from("claim_items")
      .select("id, donor_name, donor_postcode, donation_date, donation_amount, gift_aid_declaration_date, created_at")
      .eq("claim_id", claimId)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, items: items ?? [] });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
