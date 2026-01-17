import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const { data, error } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, self_submit_enabled")
      .order("name", { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({ ok: true, charities: data ?? [] });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
