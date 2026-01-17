import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const status = typeof req.query.status === "string" ? req.query.status : "";
    const charityId = typeof req.query.charityId === "string" ? req.query.charityId : "";
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    let query = supabaseAdmin
      .from("claims")
      .select(
        "id, charity_id, created_at, period_start, period_end, tax_year, total_amount, donation_count, status, hmrc_reference, hmrc_last_message"
      )
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (charityId) query = query.eq("charity_id", charityId);

    const { data: claims, error: claimsErr } = await query.range(offset, offset + limit - 1);
    if (claimsErr) return res.status(500).json({ ok: false, error: claimsErr.message });

    // Fetch charity names for the returned charity_ids (simple join alternative)
    const ids = Array.from(new Set((claims ?? []).map((c: any) => c.charity_id))).filter(Boolean);
    let charityMap: Record<string, { name: string; contact_email: string | null }> = {};

    if (ids.length) {
      const { data: charities, error: charErr } = await supabaseAdmin
        .from("charities")
        .select("id, name, contact_email")
        .in("id", ids);

      if (charErr) return res.status(500).json({ ok: false, error: charErr.message });

      charityMap = Object.fromEntries((charities ?? []).map((c: any) => [c.id, { name: c.name, contact_email: c.contact_email ?? null }]));
    }

    const enriched = (claims ?? []).map((c: any) => ({
      ...c,
      charity_name: charityMap[c.charity_id]?.name ?? "Unknown Charity",
      charity_email: charityMap[c.charity_id]?.contact_email ?? null,
    }));

    return res.status(200).json({ ok: true, claims: enriched });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
