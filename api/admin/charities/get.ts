import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const charityId = String(req.query.charityId ?? "").trim();
    if (!charityId) return res.status(400).json({ ok: false, error: "charityId is required" });

    const { data: charity, error } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, charity_number, self_submit_enabled")
      .eq("id", charityId)
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });
    if (!charity) return res.status(404).json({ ok: false, error: "Charity not found" });

    return res.status(200).json({ ok: true, charity });
  } catch (e: any) {
    return res.status(403).json({ ok: false, error: e?.message ?? "Forbidden" });
  }
}
