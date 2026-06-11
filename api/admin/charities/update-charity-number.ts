import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body);
}

function parseBody(req: VercelRequest) {
  const b = (req as any).body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return {};
}

function isAlphanumeric(str: string): boolean {
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isDigit = c >= 48 && c <= 57;
    if (!isUpper && !isLower && !isDigit) return false;
  }
  return true;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const body = parseBody(req);
    const charityId = String(body.charityId || "").trim();
    const charityNumber = String(body.charity_number || "").trim();

    if (!charityId) return send(res, 400, { ok: false, error: "charityId is required" });
    if (!charityNumber) return send(res, 400, { ok: false, error: "charity_number is required" });

    if (!isAlphanumeric(charityNumber)) {
      return send(res, 400, { ok: false, error: "Charity number must be letters and numbers only (no spaces)." });
    }

    // Check uniqueness
    const { data: dupe, error: dupeErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_number", charityNumber)
      .neq("id", charityId)
      .maybeSingle();

    if (dupeErr) return send(res, 500, { ok: false, error: dupeErr.message });
    if (dupe?.id) {
      return send(res, 400, { ok: false, error: "That charity number is already in use by another charity." });
    }

    const { error } = await supabaseAdmin
      .from("charities")
      .update({ charity_number: charityNumber })
      .eq("id", charityId);

    if (error) return send(res, 500, { ok: false, error: error.message });

    return send(res, 200, { ok: true });
  } catch (e: any) {
    return send(res, 403, { ok: false, error: e?.message ?? "Forbidden" });
  }
}
