import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function send(res: VercelResponse, status: number, body: any) {
  return res.status(status).json(body);
}

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

function normalizeCharId(v: any): string {
  return String(v ?? "").trim().toUpperCase();
}

function validateCharId(charId: string): string | null {
  if (!charId) return "HMRC CHARID is required";
  if (charId.length < 3) return "HMRC CHARID looks too short";
  if (charId.length > 30) return "HMRC CHARID looks too long";
  if (!/^[A-Z0-9\-]+$/.test(charId)) return "HMRC CHARID must be letters/numbers/hyphen only";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const body = parseBody(req);
    const charityId = String(body.charityId ?? "").trim();
    const hmrcCharId = normalizeCharId(body.hmrcCharId);

    if (!charityId) return send(res, 400, { ok: false, error: "charityId is required" });

    const vErr = validateCharId(hmrcCharId);
    if (vErr) return send(res, 400, { ok: false, error: vErr });

    const { data: updated, error } = await supabaseAdmin
      .from("charities")
      .update({ charity_id: hmrcCharId })
      .eq("id", charityId)
      .select("id, name, contact_email, charity_id, self_submit_enabled")
      .single();

    if (error) return send(res, 500, { ok: false, error: error.message });

    return send(res, 200, { ok: true, charity: updated });
  } catch (e: any) {
    return send(res, 403, { ok: false, error: e?.message ?? "Forbidden" });
  }
}
