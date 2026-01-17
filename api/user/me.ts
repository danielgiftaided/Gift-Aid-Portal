import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_utils/requireUser.js";
import { supabaseAdmin } from "../_utils/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);

    const { data, error } = await supabaseAdmin
      .from("users")
      .select("role, charity_id")
      .eq("id", user.id)
      .single();

    if (error) return res.status(500).json({ ok: false, error: error.message });

    return res.status(200).json({
      ok: true,
      role: data?.role ?? "charity_user",
      charityId: data?.charity_id ?? null
    });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
