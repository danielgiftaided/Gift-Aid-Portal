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

function normalizeRequiredString(v: any): string {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return s;
}

/**
 * We now treat "charity_number" as the HMRC CHARID (single field).
 * Letters/numbers only; stored uppercase.
 */
function normalizeHmrcCharIdFromCharityNumber(v: any): string {
  return normalizeRequiredString(v).toUpperCase();
}

function validateCharId(charId: string): string | null {
  if (!charId) return "Charity number is required";
  if (!/^[A-Z0-9]+$/.test(charId)) {
    return "Charity number must be letters/numbers only (no spaces or symbols).";
  }
  if (charId.length < 3) return "Charity number looks too short";
  if (charId.length > 30) return "Charity number looks too long";
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    const user = await requireUser(req);
    const userId = user?.id;
    if (!userId) return send(res, 401, { ok: false, error: "Invalid session user" });

    const body = parseBody(req);

    const name = normalizeRequiredString(body.name);
    const contact_email = normalizeRequiredString(body.contact_email);

    // ✅ SINGLE FIELD: charity_number == HMRC CHARID
    const hmrc_charid = normalizeHmrcCharIdFromCharityNumber(body.charity_number);

    if (!name) return send(res, 400, { ok: false, error: "Charity name is required" });
    if (!contact_email) return send(res, 400, { ok: false, error: "Contact email is required" });

    const idErr = validateCharId(hmrc_charid);
    if (idErr) return send(res, 400, { ok: false, error: idErr });

    /**
     * 1) Find the user's row in public.users safely
     */
    let existingUser: { id: string; charity_id: string | null } | null = null;

    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .maybeSingle();

    if (uErr) {
      const errMsg = String(uErr.message || "").toLowerCase();
      const looksLikeMultiple =
        errMsg.includes("cannot coerce") || errMsg.includes("single json object");

      if (!looksLikeMultiple) return send(res, 500, { ok: false, error: uErr.message });

      const { data: userRows, error: uErr2 } = await supabaseAdmin
        .from("users")
        .select("id, charity_id, created_at")
        .eq("id", userId)
        .order("created_at", { ascending: false });

      if (uErr2) return send(res, 500, { ok: false, error: uErr2.message });
      if (!userRows || userRows.length === 0) {
        return send(res, 500, {
          ok: false,
          error: "User row not found in public.users. Trigger may not have created it.",
        });
      }

      const withCharity = userRows.find((r: any) => !!r.charity_id);
      existingUser = (withCharity || userRows[0]) as any;
    } else {
      existingUser = userRow as any;
    }

    if (!existingUser) {
      return send(res, 500, {
        ok: false,
        error: "User row not found in public.users. Trigger may not have created it.",
      });
    }

    // If already linked, return existing link.
    if (existingUser.charity_id) {
      return send(res, 200, {
        ok: true,
        charity_id: existingUser.charity_id, // UUID of charities.id
        alreadySetup: true,
      });
    }

    /**
     * 2) Duplicate protection: reuse charity where charities.charity_id matches hmrc_charid
     */
    let charityDbIdToUse: string | null = null;

    const { data: existingCharity, error: exErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_id", hmrc_charid)
      .maybeSingle();

    if (exErr) return send(res, 500, { ok: false, error: exErr.message });
    if (existingCharity?.id) charityDbIdToUse = existingCharity.id;

    /**
     * 3) Otherwise create charity
     */
    if (!charityDbIdToUse) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email,
          charity_id: hmrc_charid,      // ✅ HMRC CHARID used in XML
          charity_number: hmrc_charid,  // ✅ same value (optional but consistent)
          created_by: userId,
          self_submit_enabled: false,
        })
        .select("id")
        .single();

      if (cErr) return send(res, 500, { ok: false, error: cErr.message });
      if (!created?.id) return send(res, 500, { ok: false, error: "Charity created but no id returned" });

      charityDbIdToUse = created.id;
    }

    /**
     * 4) Link user -> charity (public.users.charity_id = charities.id UUID)
     */
    const { error: linkErr } = await supabaseAdmin
      .from("users")
      .update({ charity_id: charityDbIdToUse })
      .eq("id", userId);

    if (linkErr) return send(res, 500, { ok: false, error: linkErr.message });

    return send(res, 200, {
      ok: true,
      charity_id: charityDbIdToUse,
      alreadySetup: false,
    });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
