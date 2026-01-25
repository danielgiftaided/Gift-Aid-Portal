import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

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

// Keep validation fairly permissive (HMRC refs are typically alphanumeric).
function validateCharId(charId: string): string | null {
  if (!charId) return "HMRC CHARID is required";
  if (charId.length < 3) return "HMRC CHARID looks too short";
  if (charId.length > 30) return "HMRC CHARID looks too long";
  if (!/^[A-Z0-9\-]+$/.test(charId)) return "HMRC CHARID must be letters/numbers/hyphen only";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);
    const userId = user?.id;
    if (!userId) return send(res, 401, { ok: false, error: "Not authenticated" });

    const body = parseBody(req);
    const hmrcCharId = normalizeCharId(body.hmrcCharId);

    const vErr = validateCharId(hmrcCharId);
    if (vErr) return send(res, 400, { ok: false, error: vErr });

    // Find the charity linked to this user
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("charity_id")
      .eq("id", userId)
      .single();

    if (uErr) return send(res, 500, { ok: false, error: uErr.message });
    if (!userRow?.charity_id) return send(res, 403, { ok: false, error: "User not linked to a charity" });

    const charityUuid = userRow.charity_id;

    // Update charity record (ONLY their own)
    const { data: updated, error: cErr } = await supabaseAdmin
      .from("charities")
      .update({ charity_id: hmrcCharId })
      .eq("id", charityUuid)
      .select("id, name, contact_email, charity_id")
      .single();

    if (cErr) return send(res, 500, { ok: false, error: cErr.message });

    return send(res, 200, { ok: true, charity: updated });
  } catch (e: any) {
    return send(res, 401, { ok: false, error: e?.message ?? "Unauthorized" });
  }
}
