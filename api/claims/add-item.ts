import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const user = await requireUser(req);
    const { claimId, donorName, donorPostcode, donationDate, donationAmount, declarationDate } = req.body ?? {};

    if (!claimId || !donorName || !donorPostcode || !donationDate || !donationAmount) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    // ensure claim belongs to user's charity
    const { data: userRow } = await supabaseAdmin.from("users").select("charity_id").eq("id", user.id).single();
    if (!userRow?.charity_id) return res.status(403).json({ ok: false, error: "User is not linked to a charity" });

    const { data: claim } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, status")
      .eq("id", claimId)
      .single();

    if (!claim || claim.charity_id !== userRow.charity_id) {
      return res.status(403).json({ ok: false, error: "Not allowed" });
    }
    if (claim.status !== "draft") {
      return res.status(400).json({ ok: false, error: "Only draft claims can be edited" });
    }

    const { error: insErr } = await supabaseAdmin.from("claim_items").insert({
      claim_id: claimId,
      donor_name: donorName,
      donor_postcode: donorPostcode,
      donation_date: donationDate,
      donation_amount: donationAmount,
      gift_aid_declaration_date: declarationDate ?? null
    });

    if (insErr) return res.status(500).json({ ok: false, error: insErr.message });

    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
