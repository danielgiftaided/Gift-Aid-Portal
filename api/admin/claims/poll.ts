import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";
import { hmrcTestPoll } from "../../_utils/hmrcTransport.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const { claimId } = (req.body ?? {}) as any;
    const cid = String(claimId || "").trim();
    if (!cid) return res.status(400).json({ ok: false, error: "claimId is required" });

    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, status, hmrc_correlation_id")
      .eq("id", cid)
      .single();

    if (claimErr || !claim) return res.status(404).json({ ok: false, error: claimErr?.message || "Claim not found" });
    if (!claim.hmrc_correlation_id) return res.status(400).json({ ok: false, error: "No hmrc_correlation_id stored on claim yet" });

    // NOTE: for now we keep sample credentials, same as submit.
    // Next iteration: pull per-charity creds from hmrc_connections (charity or agent mode).
    const pollResult = await hmrcTestPoll({
      correlationId: String(claim.hmrc_correlation_id),
      senderId: "GIFTAIDCHAR",
      password: "testing2",
      gatewayTest: 1,
    });

    // Save poll response text for audit/debug
    await supabaseAdmin.from("claims").update({
      hmrc_last_message: pollResult.ok
        ? `HMRC TEST poll OK (HTTP ${pollResult.status}). Check response.`
        : `HMRC TEST poll failed (HTTP ${pollResult.status}).`,
      hmrc_raw_response: pollResult.bodyText,
    }).eq("id", cid);

    return res.status(200).json({
      ok: true,
      hmrc: {
        httpStatus: pollResult.status,
        ok: pollResult.ok,
        contentType: pollResult.contentType,
        responseSnippet: pollResult.bodyText.slice(0, 800),
      },
    });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err?.message ?? "Forbidden" });
  }
}
