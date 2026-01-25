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

/**
 * Normalize optional string values so that "undefined"/"null"/"" become null.
 */
function normalizeOptionalString(v: any): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null") return null;
  return s;
}

/**
 * Normalize required string values; returns "" if invalid.
 */
function normalizeRequiredString(v: any): string {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower === "undefined" || lower === "null") return "";
  return s;
}

/**
 * HMRC CHARID normalization + validation
 */
function normalizeHmrcCharId(v: any): string {
  return normalizeRequiredString(v).toUpperCase();
}

function validateHmrcCharId(charId: string): string | null {
  if (!charId) return "Charity ID (HMRC CHARID) is required";
  if (charId.length < 3) return "Charity ID (HMRC CHARID) looks too short";
  if (charId.length > 30) return "Charity ID (HMRC CHARID) looks too long";
  if (!/^[A-Z0-9\-]+$/.test(charId)) {
    return "Charity ID (HMRC CHARID) must be letters/numbers/hyphen only";
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    // ✅ requireUser returns a user object with .id
    const user = await requireUser(req);
    const userId = user?.id;

    if (!userId) {
      return send(res, 401, { ok: false, error: "Invalid session user" });
    }

    const body = parseBody(req);

    const name = normalizeRequiredString(body.name);
    const contact_email = normalizeRequiredString(body.contact_email);

    // ✅ REQUIRED: HMRC CHARID (stored on charities.charity_id)
    const hmrc_charid = normalizeHmrcCharId(body.charity_id);

    // Optional
    const charity_number = normalizeOptionalString(body.charity_number);

    if (!name) return send(res, 400, { ok: false, error: "Charity name is required" });
    if (!contact_email) return send(res, 400, { ok: false, error: "Contact email is required" });

    const charIdErr = validateHmrcCharId(hmrc_charid);
    if (charIdErr) return send(res, 400, { ok: false, error: charIdErr });

    /**
     * 1) Check if user already has a charity.
     * Using maybeSingle() prevents the "Cannot coerce..." crash if duplicates exist.
     * If duplicates exist, we fall back to fetching all rows and selecting one.
     */
    let existingUser: { id: string; charity_id: string | null } | null = null;

    const { data: userRow, error: uErr } = await supabaseAdmin
      .from("users")
      .select("id, charity_id")
      .eq("id", userId)
      .maybeSingle();

    if (uErr) {
      const errMsg = String(uErr.message || "");
      const looksLikeMultiple =
        errMsg.toLowerCase().includes("cannot coerce") ||
        errMsg.toLowerCase().includes("single json object");

      if (!looksLikeMultiple) {
        return send(res, 500, { ok: false, error: uErr.message });
      }

      // Fetch all rows and pick newest (prefer a row that already has charity_id if any)
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

    // If already linked, return existing link
    if (existingUser.charity_id) {
      return send(res, 200, {
        ok: true,
        charity_id: existingUser.charity_id, // ✅ this is the DB UUID of charities.id
        alreadySetup: true,
      });
    }

    /**
     * 2) Duplicate protection
     * Primary: HMRC CHARID (charities.charity_id)
     * Secondary: charity_number (charities.charity_number)
     */
    let charityDbIdToUse: string | null = null;

    // 2A) reuse by HMRC CHARID (stored on charities.charity_id)
    const { data: existingByCharId, error: exCharIdErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("charity_id", hmrc_charid)
      .maybeSingle();

    if (exCharIdErr) return send(res, 500, { ok: false, error: exCharIdErr.message });
    if (existingByCharId?.id) charityDbIdToUse = existingByCharId.id;

    // 2B) reuse by charity_number (optional)
    if (!charityDbIdToUse && charity_number) {
      const { data: existingByNumber, error: exNumErr } = await supabaseAdmin
        .from("charities")
        .select("id")
        .eq("charity_number", charity_number)
        .maybeSingle();

      if (exNumErr) return send(res, 500, { ok: false, error: exNumErr.message });
      if (existingByNumber?.id) charityDbIdToUse = existingByNumber.id;
    }

    /**
     * 3) Otherwise create charity
     */
    if (!charityDbIdToUse) {
      const { data: created, error: cErr } = await supabaseAdmin
        .from("charities")
        .insert({
          name,
          contact_email,
          charity_number,
          charity_id: hmrc_charid, // ✅ HMRC CHARID stored here
          created_by: userId,
          self_submit_enabled: false,
        })
        .select("id")
        .single();

      if (cErr) return send(res, 500, { ok: false, error: cErr.message });

      if (!created?.id) {
        return send(res, 500, {
          ok: false,
          error: "Charity created but no id returned from database (created.id missing).",
        });
      }

      charityDbIdToUse = created.id;
    }

    if (!charityDbIdToUse || typeof charityDbIdToUse !== "string") {
      return send(res, 500, {
        ok: false,
        error: "Internal error: charity DB id was not created correctly.",
      });
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
      charity_id: charityDbIdToUse, // ✅ DB UUID of charities.id
      alreadySetup: false,
    });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
