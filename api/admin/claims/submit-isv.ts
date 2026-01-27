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

function getFetchErrorDetails(e: any) {
  const cause = e?.cause;
  return {
    name: String(e?.name ?? ""),
    message: String(e?.message ?? ""),
    code: String(e?.code ?? cause?.code ?? ""),
    cause: cause
      ? {
          name: String(cause?.name ?? ""),
          message: String(cause?.message ?? ""),
          code: String(cause?.code ?? ""),
        }
      : null,
  };
}

function hostFromUrl(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

async function preflight(url: string) {
  // Lightweight check: can we reach the host at all?
  // Some gateways may not like HEAD; we do a GET on the root host.
  const u = new URL(url);
  const root = `${u.protocol}//${u.host}/`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const r = await fetch(root, {
      method: "GET",
      signal: controller.signal,
    });
    return { ok: true, status: r.status };
  } catch (e: any) {
    return { ok: false, error: getFetchErrorDetails(e) };
  } finally {
    clearTimeout(timeout);
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

    const url = String(
      process.env.HMRC_ISV_SUBMISSION_URL || "https://test-transaction-engine.tax.service.gov.uk/submission"
    ).trim();

    if (!/^https:\/\//i.test(url)) {
      return res.status(400).json({ ok: false, error: "HMRC_ISV_SUBMISSION_URL must be https://..." });
    }

    // --- Preflight connectivity (very useful for debugging)
    const pf = await preflight(url);
    if (!pf.ok) {
      // save to claim for visibility
      await supabaseAdmin
        .from("claims")
        .update({
          hmrc_last_message: `ISV preflight failed to host: ${hostFromUrl(url)}`,
          hmrc_raw_response: JSON.stringify(pf, null, 2),
        })
        .eq("id", claimId);

      return res.status(502).json({
        ok: false,
        error: "ISV preflight failed (cannot reach gateway host from server)",
        hmrcUrl: url,
        details: pf,
      });
    }

    // 1) Generate XML
    const xml = await generateHmrcGiftAidXml(claimId);

    // 2) Send to ISV with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    let httpStatus = 0;
    let receiptText = "";

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

      httpStatus = hmrcRes.status;
      receiptText = await safeText(hmrcRes);

      if (!hmrcRes.ok) {
        await supabaseAdmin
          .from("claims")
          .update({
            hmrc_last_message: `HMRC ISV responded ${hmrcRes.status}`,
            hmrc_raw_response: receiptText || null,
          })
          .eq("id", claimId);

        return res.status(502).json({
          ok: false,
          error: `HMRC ISV responded ${hmrcRes.status}`,
          hmrcUrl: url,
          httpStatus,
          receipt: receiptText,
        });
      }
    } catch (e: any) {
      clearTimeout(timeout);

      const details = getFetchErrorDetails(e);

      await supabaseAdmin
        .from("claims")
        .update({
          hmrc_last_message: `HMRC ISV fetch failed: ${details.code || details.message || "unknown"}`,
          hmrc_raw_response: JSON.stringify(details, null, 2),
        })
        .eq("id", claimId);

      return res.status(502).json({
        ok: false,
        error: "fetch failed",
        hmrcUrl: url,
        details,
      });
    } finally {
      clearTimeout(timeout);
    }

    // 3) Save receipt
    await supabaseAdmin
      .from("claims")
      .update({
        status: "submitted",
        hmrc_last_message: "Sent to HMRC ISV gateway (test) — receipt received",
        hmrc_raw_response: receiptText || null,
      })
      .eq("id", claimId);

    return res.status(200).json({
      ok: true,
      hmrcUrl: url,
      httpStatus,
      receipt: receiptText,
    });
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? "HMRC ISV request timed out (25s). Try again."
        : e?.message ?? "Server error";

    return res.status(500).json({ ok: false, error: msg });
  }
}
