import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function safeJson(res: VercelResponse, status: number, payload: any) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(payload));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return safeJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const charityId = typeof req.query.charityId === "string" ? req.query.charityId : "";
    if (!charityId) return safeJson(res, 400, { ok: false, error: "charityId is required" });

    // 1) Charity details
    const { data: charity, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, name, contact_email, self_submit_enabled")
      .eq("id", charityId)
      .single();

    if (charityErr) return safeJson(res, 500, { ok: false, error: charityErr.message });
    if (!charity) return safeJson(res, 404, { ok: false, error: "Charity not found" });

    // 2) Total gift-aidable donations = SUM(claim_items.donation_amount) for claims of this charity
    // (We do this in 2 steps to keep it simple without SQL RPC)
    const { data: claimIds, error: claimIdsErr } = await supabaseAdmin
      .from("claims")
      .select("id")
      .eq("charity_id", charityId);

    if (claimIdsErr) return safeJson(res, 500, { ok: false, error: claimIdsErr.message });

    const ids = (claimIds ?? []).map((x: any) => x.id);
    let totalDonations = 0;

    if (ids.length > 0) {
      const { data: items, error: itemsErr } = await supabaseAdmin
        .from("claim_items")
        .select("donation_amount")
        .in("claim_id", ids);

      if (itemsErr) return safeJson(res, 500, { ok: false, error: itemsErr.message });

      totalDonations = (items ?? []).reduce(
        (sum: number, r: any) => sum + Number(r.donation_amount || 0),
        0
      );
    }

    // 3) Total Gift Aid successfully claimed back = SUM(submissions.amount_claimed WHERE status='approved')
    const { data: approvedSubs, error: subsErr } = await supabaseAdmin
      .from("submissions")
      .select("amount_claimed")
      .eq("charity_id", charityId)
      .eq("status", "approved");

    if (subsErr) return safeJson(res, 500, { ok: false, error: subsErr.message });

    const totalGiftAidClaimedBack = (approvedSubs ?? []).reduce(
      (sum: number, r: any) => sum + Number(r.amount_claimed || 0),
      0
    );

    // 4) Optional: counts for quick dashboard
    const { count: claimCount } = await supabaseAdmin
      .from("claims")
      .select("id", { count: "exact", head: true })
      .eq("charity_id", charityId);

    const { count: submissionCount } = await supabaseAdmin
      .from("submissions")
      .select("id", { count: "exact", head: true })
      .eq("charity_id", charityId);

    return safeJson(res, 200, {
      ok: true,
      charity,
      totals: {
        totalGiftAidableDonations: totalDonations,
        totalGiftAidClaimedBack,
        claimCount: claimCount ?? 0,
        submissionCount: submissionCount ?? 0,
      },
    });
  } catch (err: any) {
    return safeJson(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
