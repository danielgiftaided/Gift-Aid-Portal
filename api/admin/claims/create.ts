import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function safeJson(res: VercelResponse, status: number, payload: any) {
  return res.status(status).setHeader("Content-Type", "application/json").send(JSON.stringify(payload));
}

function parseBody(req: VercelRequest): any {
  // Vercel sometimes gives body as object, sometimes as string (depending on runtime)
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
      return safeJson(res, 405, { ok: false, error: "Method not allowed" });
    }

    // Authz: operator only
    await requireOperator(req);

    const body = parseBody(req);
    const { charityId, periodStart, periodEnd, taxYear } = body;

    if (!charityId || !periodStart || !periodEnd) {
      return safeJson(res, 400, {
        ok: false,
        error: "charityId, periodStart, periodEnd are required",
        received: { charityId: !!charityId, periodStart: !!periodStart, periodEnd: !!periodEnd },
      });
    }

    // Optional: verify charity exists (gives clearer errors)
    const { data: charity, error: charErr } = await supabaseAdmin
      .from("charities")
      .select("id")
      .eq("id", charityId)
      .single();

    if (charErr || !charity) {
      return safeJson(res, 400, { ok: false, error: "Invalid charityId (charity not found)" });
    }

    const { data: claim, error } = await supabaseAdmin
      .from("claims")
      .insert({
        charity_id: charityId,
        period_start: periodStart,
        period_end: periodEnd,
        tax_year: taxYear ?? null,
        status: "draft",
      })
      .select("*")
      .single();

    if (error) {
      return safeJson(res, 500, { ok: false, error: error.message });
    }

    return safeJson(res, 200, { ok: true, claim });
  } catch (err: any) {
    // IMPORTANT: never let raw crashes bubble up — always send JSON
    return safeJson(res, 500, {
      ok: false,
      error: err?.message ?? "Server error",
      hint: "Check Vercel logs for stack trace if this persists",
    });
  }
}

