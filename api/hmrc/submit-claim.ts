import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";
import { buildGiftAidClaimXml } from "../_utils/hmrcXml.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const user = await requireUser(req);
    const { claimId } = req.body ?? {};
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    // map user -> charity
    const { data: userRow } = await supabaseAdmin.from("users").select("charity_id").eq("id", user.id).single();
    if (!userRow?.charity_id) return res.status(403).json({ ok: false, error: "User is not linked to a charity" });

    // load claim
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, period_start, period_end, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: "Claim not found" });
    if (claim.charity_id !== userRow.charity_id) return res.status(403).json({ ok: false, error: "Not allowed" });
    if (claim.status !== "draft") return res.status(400).json({ ok: false, error: "Only draft claims can be submitted" });

    // load charity info (you should store HMRC reference on the charity record)
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, hmrc_reference")
      .eq("id", claim.charity_id)
      .single();

    if (charityErr || !charity) return res.status(500).json({ ok: false, error: "Charity missing" });
    if (!charity.hmrc_reference) return res.status(400).json({ ok: false, error: "Charity is missing hmrc_reference" });

    // load claim items
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("claim_items")
      .select("donor_name, donor_postcode, donation_date, donation_amount, gift_aid_declaration_date")
      .eq("claim_id", claimId);

    if (itemsErr) return res.status(500).json({ ok: false, error: itemsErr.message });
    if (!items || items.length === 0) return res.status(400).json({ ok: false, error: "No donations in this claim" });

    // build XML
    const xml = buildGiftAidClaimXml({
      claimId,
      charityHmrcRef: charity.hmrc_reference,
      periodStart: String(claim.period_start),
      periodEnd: String(claim.period_end),
      items: items.map((it: any) => ({
        donorName: it.donor_name,
        donorPostcode: it.donor_postcode,
        donationDate: String(it.donation_date),
        donationAmount: Number(it.donation_amount),
        declarationDate: it.gift_aid_declaration_date ? String(it.gift_aid_declaration_date) : null
      }))
    });

    // For now: store XML and mark "submitted" WITHOUT actually calling HMRC yet.
    // Next step is wiring the real HMRC transport based on the Charities Online technical pack.
    const totalAmount = items.reduce((s: number, it: any) => s + Number(it.donation_amount || 0), 0);

    await supabaseAdmin.from("claims").update({
      status: "submitted",
      donation_count: items.length,
      total_amount: totalAmount,
      hmrc_last_message: "Submitted to queue (transport not yet wired)",
      hmrc_raw_response: xml
    }).eq("id", claimId);

    return res.status(200).json({ ok: true, message: "Claim prepared and marked submitted", xmlPreview: xml.slice(0, 200) + "..." });
  } catch (err: any) {
    return res.status(401).json({ ok: false, error: err.message });
  }
}
