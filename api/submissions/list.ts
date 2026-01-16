import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // 1) Verify user is logged in
    const user = await requireUser(req);

    // 2) Find which charity this user belongs to
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("charity_id")
      .eq("id", user.id)
      .single();

    if (userErr || !userRow?.charity_id) {
      return res.status(403).json({
        ok: false,
        error: "User is not linked to a charity",
      });
    }

    const charityId = userRow.charity_id as string;

    // Optional pagination
    const limit = Math.min(Number(req.query.limit ?? 50), 200); // max 200
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    // 3) Return submissions only for this charity
    const { data: submissions, error: subErr } = await supabaseAdmin
      .from("submissions")
      .select("id, submission_date, status, hmrc_reference, amount_claimed, number_of_donations, tax_year")
      .eq("charity_id", charityId)
      .order("submission_date", { ascending: false })
      .range(offset, offset + limit - 1);

    if (subErr) {
      return res.status(500).json({ ok: false, error: subErr.message });
    }

    return res.status(200).json({
      ok: true,
      charityId,
      count: submissions?.length ?? 0,
      submissions: submissions ?? [],
    });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
