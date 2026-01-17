import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const { claimId, donorName, donorPostcode, donationDate, donationAmount, declarationDate } = req.body ?? {};
    if (!claimId || !donorName || !donorPostcode || !donationDate || donationAmount == null) {
      return res.status(400).json({ ok: false, error: "Missing required fields" });
    }

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: "Claim not found" });
    if (claim.status !== "draft") return res.status(400).json({ ok: false, error: "Only draft claims can be edited" });

    const { error } = await supabaseAdmin.from("claim_items").insert({
      claim_id: claimId,
      donor_name: donorName,
      donor_postcode: donorPostcode,
      donation_date: donationDate,
      donation_amount: donationAmount,
      gift_aid_declaration_date: declarationDate ?? null,
    });

    if (error) return res.status(500).json({ ok: false, error: error.message });
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
