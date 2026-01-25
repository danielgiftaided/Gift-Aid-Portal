import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";
import { buildGiftAidClaimXml } from "../../_utils/hmrcXml.js";
import { hmrcTestSubmit } from "../../_utils/hmrcTransport.js";

function parseBody(req: VercelRequest) {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const body = parseBody(req);
    const claimId = String(body.claimId || "").trim();
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    // 1) Load claim
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, period_start, period_end, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: claimErr?.message || "Claim not found" });
    if (claim.status !== "ready") return res.status(400).json({ ok: false, error: "Claim must be 'ready' to submit" });

    // 2) Load charity (we are using charities.charity_number as HMRC CHARID)
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, charity_number")
      .eq("id", claim.charity_id)
      .single();

    if (charityErr || !charity) return res.status(500).json({ ok: false, error: charityErr?.message || "Charity missing" });

    const hmrcCharId = String(charity.charity_number || "").trim();
    if (!hmrcCharId) {
      return res.status(400).json({
        ok: false,
        error: "Charity number (HMRC CHARID) is missing. Ask an operator to set it in Admin > Charity Detail.",
      });
    }

    // 3) Load claim items (your newer schema fields)
    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("claim_items")
      .select("donor_title, donor_first_name, donor_last_name, donor_address, donor_postcode, donation_date, donation_amount")
      .eq("claim_id", claimId);

    if (itemsErr) return res.status(500).json({ ok: false, error: itemsErr.message });
    if (!items || items.length === 0) return res.status(400).json({ ok: false, error: "No donations in this claim" });

    // 4) Build XML
    const xml = buildGiftAidClaimXml({
      claimId,
      hmrcCharId,
      orgName: charity.name,
      periodEnd: String(claim.period_end),
      items: items.map((it: any) => ({
        title: it.donor_title || null,
        firstName: it.donor_first_name,
        lastName: it.donor_last_name,
        address: it.donor_address,
        postcode: it.donor_postcode,
        donationDate: String(it.donation_date),
        donationAmount: Number(it.donation_amount),
      })),
      // For now keep these sample-style values; later we’ll pull from hmrc_connections
      senderId: "GIFTAIDCHAR",
      password: "testing2",
      gatewayTest: 1,
      productName: "GA Valid Sample",
      channelUri: "0000",
    });

    // 5) Send to HMRC TEST endpoint
    const submitResult = await hmrcTestSubmit(xml);

    // 6) Store submission response + mark as pending
    const totalAmount = items.reduce((s: number, it: any) => s + Number(it.donation_amount || 0), 0);

    const { error: updErr } = await supabaseAdmin.from("claims").update({
      status: "submitted", // or "pending" if you prefer
      donation_count: items.length,
      total_amount: totalAmount,
      hmrc_correlation_id: claimId, // we used claimId as CorrelationID
      hmrc_last_message: submitResult.ok
        ? `HMRC TEST submit accepted (HTTP ${submitResult.status}). Next: poll.`
        : `HMRC TEST submit failed (HTTP ${submitResult.status}).`,
      hmrc_raw_response: submitResult.bodyText,
    }).eq("id", claimId);

    if (updErr) return res.status(500).json({ ok: false, error: updErr.message });

    return res.status(200).json({
      ok: true,
      hmrc: {
        httpStatus: submitResult.status,
        ok: submitResult.ok,
        contentType: submitResult.contentType,
        responseSnippet: submitResult.bodyText.slice(0, 400),
      },
    });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err?.message ?? "Forbidden" });
  }
}
