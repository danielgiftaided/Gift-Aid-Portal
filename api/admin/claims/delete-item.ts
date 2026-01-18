import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../../_utils/supabase.js";
import { requireOperator } from "../../_utils/requireOperator.js";

function json(res: VercelResponse, status: number, payload: any) {
  return res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .send(JSON.stringify(payload));
}

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
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "Method not allowed" });

    await requireOperator(req);

    const body = parseBody(req);
    const { itemId } = body;

    if (!itemId) return json(res, 400, { ok: false, error: "itemId is required" });

    // DB trigger will block deletes unless claim is 'draft'
    const { error } = await supabaseAdmin
      .from("claim_items")
      .delete()
      .eq("id", itemId);

    if (error) return json(res, 500, { ok: false, error: error.message });

    return json(res, 200, { ok: true });
  } catch (err: any) {
    return json(res, 500, { ok: false, error: err?.message ?? "Server error" });
  }
}
