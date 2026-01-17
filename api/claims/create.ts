import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);
    const { periodStart, periodEnd, taxYear } = req.body ?? {};

    if (!periodStart || !periodEnd) {
      return res.status(400).json({ ok: false, error: "periodStart and periodEnd are required" });
    }

    // find charity_id for this user
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("charity_id")
      .eq("id", user.id)
      .single();

    if (userErr || !userRow?.charity_id) {
      return res.status(403).json({ ok: false, error: "User is not linked to a charity" });
    }

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .insert({
        charity_id: userRow.charity_id,
        period_start: periodStart,
        period_end: periodEnd,
        tax_year: taxYear ?? null,
        status: "draft"
      })
      .select("*")
      .single();

    if (claimErr) return res.status(500).json({ ok: false, error: claimErr.message });

    return res.status(200).json({ ok: true, claim });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
