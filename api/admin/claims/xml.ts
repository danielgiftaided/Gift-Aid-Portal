import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireOperator } from "../../_utils/requireOperator.js";
import { generateHmrcGiftAidXml } from "../../_utils/hmrcXml.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ Admin/operator only
    await requireOperator(req);

    const claimId = String(req.query.claimId || "").trim();
    if (!claimId) {
      return res.status(400).json({ ok: false, error: "claimId is required" });
    }

    const xml = await generateHmrcGiftAidXml(claimId);

    // Return as XML (so opening in browser shows XML, not JSON)
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    // Optional: this makes it download as a file
    res.setHeader("Content-Disposition", `inline; filename="claim-${claimId}.xml"`);

    return res.status(200).send(xml);
  } catch (e: any) {
    // Common cases:
    // - not operator -> requireOperator throws
    // - missing template placeholders -> generator throws
    return res.status(500).json({ ok: false, error: e?.message ?? "Server error" });
  }
}
