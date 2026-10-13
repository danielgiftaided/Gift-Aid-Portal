import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireUser } from "../_utils/requireUser.js";
import { supabaseAdmin } from "../_utils/supabase.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);

    // Get user's role and charity_id
    const { data: userData, error: userError } = await supabaseAdmin
      .from("users")
      .select("role, charity_id")
      .eq("id", user.id)
      .maybeSingle();

    if (userError) return res.status(500).json({ ok: false, error: userError.message });

    if (!userData) {
      return res.status(403).json({
        ok: false,
        code: "PORTAL_PROFILE_MISSING",
        error: "Your signed-in account has no portal profile. Sign out and sign in with your registered portal account, or ask your administrator to restore your existing profile.",
      });
    }

    // Get charity name separately using service role key (bypasses RLS)
    let charityName: string | null = null;
    if (userData?.charity_id) {
      const { data: charityData } = await supabaseAdmin
        .from("charities")
        .select("name")
        .eq("id", userData.charity_id)
        .single();
      charityName = charityData?.name ?? null;
    }

    return res.status(200).json({
      ok: true,
      role: userData?.role ?? "charity_user",
      charityId: userData?.charity_id ?? null,
      charityName,
    });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
