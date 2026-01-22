import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";
import { decryptJson } from "../../_utils/crypto.js";

/**
 * Vercel can deliver req.body as:
 * - object (already parsed)
 * - string (raw JSON)
 * - undefined
 */
function parseBody(req: VercelRequest): any {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // ✅ operator-only enforcement
    await requireOperator(req);

    const body = parseBody(req);
    const claimId = String(body.claimId || "").trim();
    if (!claimId) {
      return res.status(400).json({ ok: false, error: "claimId is required" });
    }

    // 1) Load claim (need charity_id + status)
    const { data: claim, error: claimErr } = await supabaseAdmin
      .from("claims")
      .select("id, charity_id, status")
      .eq("id", claimId)
      .single();

    if (claimErr || !claim) {
      return res.status(404).json({ ok: false, error: "Claim not found" });
    }

    if (claim.status !== "ready") {
      return res
        .status(400)
        .json({ ok: false, error: "Claim must be 'ready' to submit" });
    }

    // 2) Load charity HMRC connection pointer
    const { data: charityRow, error: charityErr } = await supabaseAdmin
      .from("charities")
      .select("id, hmrc_connection_id, hmrc_mode")
      .eq("id", claim.charity_id)
      .single();

    if (charityErr || !charityRow) {
      return res.status(404).json({ ok: false, error: "Charity not found" });
    }

    // If not set, we cannot submit automatically.
    if (!charityRow.hmrc_connection_id) {
      return res.status(400).json({
        ok: false,
        error:
          "This charity has no HMRC connection set. Ask the charity (or admin) to enter HMRC credentials first.",
      });
    }

    // 3) Load the active HMRC connection
    const { data: conn, error: connErr } = await supabaseAdmin
      .from("hmrc_connections")
      .select("id, charity_id, mode, active, credentials_encrypted, updated_at")
      .eq("id", charityRow.hmrc_connection_id)
      .eq("active", true)
      .single();

    if (connErr || !conn) {
      return res.status(400).json({
        ok: false,
        error:
          "HMRC connection not found or not active. Please re-save the HMRC credentials.",
      });
    }

    // 4) Decrypt credentials (server-side only)
    // IMPORTANT: never return these to client, never log passwords.
    let creds: any;
    try {
      creds = decryptJson(conn.credentials_encrypted);
    } catch (e: any) {
      return res.status(500).json({
        ok: false,
        error:
          "Failed to decrypt HMRC credentials. Check HMRC_CRED_ENCRYPTION_KEY is set correctly in Vercel.",
      });
    }

    const gatewayUserId = String(creds?.gatewayUserId || "").trim();
    const gatewayPassword = String(creds?.gatewayPassword || "").trim();

    if (!gatewayUserId || !gatewayPassword) {
      return res.status(400).json({
        ok: false,
        error:
          "HMRC credentials are incomplete. Please re-save them (gatewayUserId + gatewayPassword).",
      });
    }

    // ✅ At this point, we have everything required to submit to HMRC.
    // NEXT STEP (later): Build XML + IRmark + transport to HMRC Charities Online XML endpoint.
    // For now, we confirm end-to-end operator flow + credential lookup works.

    const modeLabel =
      charityRow.hmrc_mode === "central" ? "central" : "charity";

    const { error: updateErr } = await supabaseAdmin
      .from("claims")
      .update({
        status: "submitted",
        hmrc_last_message:
          `Submitted by operator (HMRC transport not yet connected). ` +
          `Connection mode: ${modeLabel}.`,
      })
      .eq("id", claimId);

    if (updateErr) {
      return res.status(500).json({ ok: false, error: updateErr.message });
    }

    return res.status(200).json({
      ok: true,
      submitted: true,
      claimId,
      charityId: claim.charity_id,
      hmrcMode: charityRow.hmrc_mode ?? "charity",
      connectionId: conn.id,
      // Never return password; we only confirm the connection is present.
      gatewayUserIdMasked:
        gatewayUserId.length <= 3
          ? "***"
          : `${gatewayUserId.slice(0, 2)}***${gatewayUserId.slice(-1)}`,
    });
  } catch (err: any) {
    return res.status(403).json({ ok: false, error: err.message });
  }
}
