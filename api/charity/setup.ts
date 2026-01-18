import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

function send(res: VercelResponse, status: number, body: any) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(body));
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

    const { userId } = await requireUser(req); // validates Bearer token + gives userId

    const body = parseBody(req);
    const name = String(body.name || "").trim();
    const contact_email = String(body.contact_email || "").trim();
    const charity_number = body.charity_number ? String(body.charity_number).trim() : null;

    if (!name) return send(res, 400, { ok: false, error: "Charity name is required" });
    if (!contact_email) return send(res, 400, { ok: false, error: "Contact email is required" });

    // Check if user already has a charity
    const { data: existingUser, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .single();

    if (uErr) return send(res, 500, { ok: false, error: uErr.message });
    if (existingUser?.charity_id) {
      return send(res, 200, { ok: true, charity_id: existingUser.charity_id, alreadySetup: true });
    }

    // Optional duplicate protection: if charity number exists, reuse charity
    let charityIdToUse: string | null = null;

    if (charity_number) {
      const { data: existingCharity } = await supabaseAdmin
        .from("charities")
        .select("id")
        .eq("charity_number", charity_number)
        .maybeSingle();

      if (existingCharity?.id) charityIdToUse = existingCharity.id;
    }

    // Otherwise create charity
    if (!charityIdToUse) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email,
          charity_number,
          created_by: userId,
          self_submit_enabled: false,
        })
        .select("id")
        .single();

      if (cErr) return send(res, 500, { ok: false, error: cErr.message });
      charityIdToUse = created.id;
    }

    // Link user -> charity
    const { error: linkErr } = await supabaseAdmin
      .from("users")
      .update({ charity_id: charityIdToUse })
      .eq("id", userId);

    if (linkErr) return send(res, 500, { ok: false, error: linkErr.message });

    return send(res, 200, { ok: true, charity_id: charityIdToUse, alreadySetup: false });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
