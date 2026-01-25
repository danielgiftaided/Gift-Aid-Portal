import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);

    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("charity_id")
      .eq("id", user.id)
      .single();

    if (userErr || !userRow?.charity_id) {
      return res.status(403).json({ ok: false, error: "User is not linked to a charity" });
    }

    const { data: charity, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, charity_id")
      .eq("id", userRow.charity_id)
      .single();

    if (charityErr || !charity) {
      return res.status(404).json({ ok: false, error: "Charity not found" });
    }

    return res.status(200).json({ ok: true, charity });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
