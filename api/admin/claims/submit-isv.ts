import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireOperator } from "../../_utils/requireOperator.js";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { generateHmrcGiftAidXml, HMRC_XML_VERSION } from "../../_utils/hmrcXml.js";

function parseBody(req: VercelRequest) {
  const b: any = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try {
      return JSON.parse(b);
    } catch {
      return {};
    }
  }
  return {};
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const body = parseBody(req);
    const claimId = String(body.claimId || "").trim();
    if (!claimId) return res.status(400).json({ ok: false, error: "claimId is required" });

    // prove deployed version
    res.setHeader("x-hmrc-xml-version", HMRC_XML_VERSION);

    // 1) Generate XML
    const xml = await generateHmrcGiftAidXml(claimId);

    // 2) Send to HMRC ISV (test gateway)
    const url = String(process.env.HMRC_ISV_SUBMISSION_URL || "https://secure.dev.gateway.gov.uk/submission").trim();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    let receiptText = "";
    let status = 0;

    try {
      const hmrcRes = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          Accept: "text/xml, application/xml, */*",
        },
        body: xml,
        signal: controller.signal,
      });

      status = hmrcRes.status;
      receiptText = await safeText(hmrcRes);

      if (!hmrcRes.ok) {
        // Save the failed receipt too (helps debugging)
        await supabaseAdmin
          .from("claims")
          .update({
            hmrc_last_message: `HMRC ISV submission failed (${hmrcRes.status})`,
            hmrc_raw_response: receiptText || null,
          })
          .eq("id", claimId);

        return res.status(502).json({
          ok: false,
          error: `HMRC ISV responded ${hmrcRes.status}`,
          receipt: receiptText,
        });
      }
    } finally {
      clearTimeout(timeout);
    }

    // 3) Save receipt on the claim (so it shows later)
    await supabaseAdmin
      .from("claims")
      .update({
        // keep your workflow the way you want — this is just a “sent to ISV” marker
        status: "submitted",
        hmrc_last_message: "Sent to HMRC ISV gateway (test) — receipt received",
        hmrc_raw_response: receiptText || null,
      })
      .eq("id", claimId);

    return res.status(200).json({
      ok: true,
      hmrcUrl: url,
      httpStatus: status,
      receipt: receiptText,
    });
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "HMRC ISV request timed out (25s). Try again or check gateway availability."
        : e?.message ?? "Server error";

    return res.status(500).json({ ok: false, error: msg });
  }
}
