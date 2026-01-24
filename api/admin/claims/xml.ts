import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireOperator } from "../../_utils/requireOperator.js";
import { generateHmrcGiftAidXml } from "../../_utils/hmrcXml"; // ✅ NO .js extension

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const claimId = String(req.query.claimId || "").trim();
    if (!claimId) {
      return res.status(400).json({ ok: false, error: "claimId is required" });
    }

    const xml = await generateHmrcGiftAidXml(claimId);

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="claim-${claimId}.xml"`);

    return res.status(200).send(xml);
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message ?? "Server error" });
  }
}
