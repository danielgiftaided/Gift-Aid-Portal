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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const body = parseBody(req);

    const charityId = String(body.charityId || "").trim();

    // ✅ accept either "charity_number" OR "charityNumber" from the UI
    const charityNumberRaw =
      body.charity_number ?? body.charityNumber ?? body.hmrcCharId ?? "";

    const charityNumber = String(charityNumberRaw || "").trim();

    if (!charityId) return send(res, 400, { ok: false, error: "charityId is required" });
    if (!charityNumber) {
      return send(res, 400, { ok: false, error: "charityNumber is required" });
    }

    // letters/numbers only (no spaces)
    if (!/^[A-Za-z0-9]+$/.test(charityNumber)) {
      return send(res, 400, {
        ok: false,
        error: "Charity number must be letters/numbers only (no spaces).",
      });
    }

    // Optional: enforce uniqueness so two charities can’t share the same number
    const { data: dupe, error: dupeErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_number", charityNumber)
      .neq("id", charityId)
      .maybeSingle();

    if (dupeErr) return send(res, 500, { ok: false, error: dupeErr.message });

    if (dupe?.id) {
      return send(res, 400, {
        ok: false,
        error: "That charity number is already in use by another charity.",
      });
    }

    // ✅ update and return the updated charity (helps the UI refresh cleanly)
    const { data: updated, error } = await supabaseAdmin
      .from("charities")
      .update({ charity_number: charityNumber })
      .eq("id", charityId)
      .select("id, name, contact_email, charity_number, self_submit_enabled")
      .single();

    if (error) return send(res, 500, { ok: false, error: error.message });

    return send(res, 200, { ok: true, charity: updated });
  } catch (e: any) {
    return send(res, 403, { ok: false, error: e?.message ?? "Forbidden" });
  }
}
