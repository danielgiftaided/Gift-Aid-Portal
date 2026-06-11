import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

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

    const user = await requireUser(req);
    const userId = user?.id;
    if (!userId) {
      return send(res, 401, { ok: false, error: "Invalid session user" });
    }

    const body = parseBody(req);
    const name = String(body.name || "").trim();
    const contact_email = String(body.contact_email || "").trim();
    const charity_number = String(body.charity_number || "").trim().toUpperCase();

    if (!name) return send(res, 400, { ok: false, error: "Charity name is required" });
    if (!contact_email) return send(res, 400, { ok: false, error: "Contact email is required" });
    if (!charity_number) return send(res, 400, { ok: false, error: "Charity number is required" });
    if (charity_number.length < 3) return send(res, 400, { ok: false, error: "Charity number looks too short" });
    if (charity_number.length > 30) return send(res, 400, { ok: false, error: "Charity number looks too long" });
    if (!isAlphanumeric(charity_number)) {
      return send(res, 400, { ok: false, error: "Charity number must be letters and numbers only (no spaces or symbols)" });
    }

    // Check if user already has a charity linked
    const { data: existingUser, error: userErr } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .maybeSingle();

    if (userErr) return send(res, 500, { ok: false, error: userErr.message });

    if (!existingUser) {
      return send(res, 500, { ok: false, error: "User row not found. Please contact support." });
    }

    if (existingUser.charity_id) {
      return send(res, 200, { ok: true, charity_id: existingUser.charity_id, alreadySetup: true });
    }

    // Check if charity number already exists
    const { data: existingCharity, error: checkErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_id", charity_number)
      .maybeSingle();

    if (checkErr) return send(res, 500, { ok: false, error: checkErr.message });

    let charityId = existingCharity?.id ?? null;

    // Create new charity if not found
    if (!charityId) {
      const { data: created, error: createErr } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email,
          charity_id: charity_number,
          charity_number: charity_number,
          created_by: userId,
          self_submit_enabled: false,
        })
        .select("id")
        .single();

      if (createErr) return send(res, 500, { ok: false, error: createErr.message });
      if (!created?.id) return send(res, 500, { ok: false, error: "Charity created but no id returned" });

      charityId = created.id;
    }

    // Link user to charity
    const { error: linkErr } = await supabaseAdmin
      .from("users")
      .update({ charity_id: charityId })
      .eq("id", userId);

    if (linkErr) return send(res, 500, { ok: false, error: linkErr.message });

    return send(res, 200, { ok: true, charity_id: charityId, alreadySetup: false });

  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
