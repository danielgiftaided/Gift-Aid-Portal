import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../../_utils/supabase.js";
import { requireOperator } from "../../../_utils/requireOperator.js";
import { encryptJson } from "../../../_utils/crypto.js";

function send(res: VercelResponse, status: number, body: any) {
  return res.status(status).json(body);
}

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
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method not allowed" });

    const operator = await requireOperator(req);
    const operatorId = operator.id;

    const body = parseBody(req);
    const charityId = String(body.charityId || "").trim();

    const gatewayUserId = String(body.gatewayUserId || "").trim();
    const gatewayPassword = String(body.gatewayPassword || "").trim();

    if (!charityId) return send(res, 400, { ok: false, error: "charityId is required" });
    if (!gatewayUserId) return send(res, 400, { ok: false, error: "gatewayUserId is required" });
    if (!gatewayPassword) return send(res, 400, { ok: false, error: "gatewayPassword is required" });

    const encrypted = encryptJson({
      gatewayUserId,
      gatewayPassword,
      updatedAt: new Date().toISOString(),
    });

    // deactivate existing active
    await supabaseAdmin
      .from("hmrc_connections")
      .update({ active: false, updated_by: operatorId, updated_at: new Date().toISOString() })
      .eq("charity_id", charityId)
      .eq("active", true);

    const { data: created, error: cErr } = await supabaseAdmin
      .from("hmrc_connections")
      .insert({
        charity_id: charityId,
        mode: "charity",
        active: true,
        credentials_encrypted: encrypted,
        created_by: operatorId,
        updated_by: operatorId,
      })
      .select("id")
      .single();

    if (cErr) return send(res, 500, { ok: false, error: cErr.message });

    await supabaseAdmin
      .from("charities")
      .update({ hmrc_connection_id: created.id, hmrc_mode: "charity" })
      .eq("id", charityId);

    return send(res, 200, { ok: true, connectionId: created.id });
  } catch (e: any) {
    return send(res, 403, { ok: false, error: e?.message ?? "Forbidden" });
  }
}
