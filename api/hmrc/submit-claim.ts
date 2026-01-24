import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";
import { generateHmrcGiftAidXml } from "../_utils/hmrcXml.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);
    const { claimId } = req.body ?? {};
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    // map user -> charity
    const { data: userRow, error: userErr } = await supabaseAdmin
      .from("users")
      .select("charity_id")
      .eq("id", user.id)
      .single();

    if (userErr) return res.status(500).json({ ok: false, error: userErr.message });
    if (!userRow?.charity_id) return res.status(403).json({ ok: false, error: "User is not linked to a charity" });

    // load claim
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, period_end, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: "Claim not found" });
    if (claim.charity_id !== userRow.charity_id) return res.status(403).json({ ok: false, error: "Not allowed" });

    // keep your rule (only draft here)
    if (claim.status !== "draft") {
      return res.status(400).json({ ok: false, error: "Only draft claims can be submitted" });
    }

    // ensure charity has charity_id (HMRC CHARID)
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, charity_id")
      .eq("id", claim.charity_id)
      .single();

    if (charityErr || !charity) return res.status(500).json({ ok: false, error: "Charity missing" });
    if (!charity.charity_id) {
      return res.status(400).json({ ok: false, error: "Charity is missing charity_id (required)" });
    }

    // ensure claim has at least 1 item
    const { count, error: countErr } = await supabaseAdmin
      .from("claim_items")
      .select("id", { count: "exact", head: true })
      .eq("claim_id", claimId);

    if (countErr) return res.status(500).json({ ok: false, error: countErr.message });
    if (!count || count === 0) return res.status(400).json({ ok: false, error: "No donations in this claim" });

    // build XML using shared generator (loads claim/charity/items itself)
    const xml = await generateHmrcGiftAidXml(String(claimId));

    // compute totals (for your claims table summary fields)
    const { data: amounts, error: amtErr } = await supabaseAdmin
      .from("claim_items")
      .select("donation_amount")
      .eq("claim_id", claimId);

    if (amtErr) return res.status(500).json({ ok: false, error: amtErr.message });

    const totalAmount = (amounts || []).reduce((s: number, it: any) => s + Number(it?.donation_amount || 0), 0);

    await supabaseAdmin
      .from("claims")
      .update({
        status: "submitted",
        donation_count: count,
        total_amount: totalAmount,
        hmrc_last_message: "Submitted to queue (transport not yet wired)",
        hmrc_raw_response: xml,
      })
      .eq("id", claimId);

    return res.status(200).json({
      ok: true,
      message: "Claim prepared and marked submitted",
      xmlPreview: xml.slice(0, 200) + "...",
    });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
