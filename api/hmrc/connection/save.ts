import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireUser } from "../../_utils/requireUser.js";
import { encryptJson } from "../../_utils/crypto.js";

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

    const user = await requireUser(req);
    const userId = user.id;

    const body = parseBody(req);

    // Keep these generic (you can rename later to match HMRC requirements)
    const gatewayUserId = String(body.gatewayUserId || "").trim();
    const gatewayPassword = String(body.gatewayPassword || "").trim();

    if (!gatewayUserId) return send(res, 400, { ok: false, error: "gatewayUserId is required" });
    if (!gatewayPassword) return send(res, 400, { ok: false, error: "gatewayPassword is required" });

    // Find user's charity_id
    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("charity_id, role")
      .eq("id", userId)
      .maybeSingle();

    if (uErr) return send(res, 500, { ok: false, error: uErr.message });
    if (!userRow?.charity_id) return send(res, 403, { ok: false, error: "User is not linked to a charity" });

    // Optional: prevent operators from using this path (they should use admin endpoint)
    // if (userRow.role === "operator") return send(res, 403, { ok: false, error: "Use admin endpoint" });

    const encrypted = encryptJson({
      gatewayUserId,
      gatewayPassword,
      updatedAt: new Date().toISOString(),
    });

    // Upsert: deactivate old active connection, insert a new one
    await supabaseAdmin
      .from("hmrc_connections")
      .update({ active: false, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("charity_id", userRow.charity_id)
      .eq("active", true);

    const { data: created, error: cErr } = await supabaseAdmin
      .from("hmrc_connections")
      .insert({
        charity_id: userRow.charity_id,
        mode: "charity",
        active: true,
        credentials_encrypted: encrypted,
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();

    if (cErr) return send(res, 500, { ok: false, error: cErr.message });

    // Point charity to latest connection
    await supabaseAdmin
      .from("charities")
      .update({ hmrc_connection_id: created.id, hmrc_mode: "charity" })
      .eq("id", userRow.charity_id);

    return send(res, 200, { ok: true, connectionId: created.id });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
