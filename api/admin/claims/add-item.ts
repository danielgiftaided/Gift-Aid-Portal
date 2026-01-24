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

function norm(v: any): string {
  return String(v ?? "").trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") {
      return send(res, 405, { ok: false, error: "Method not allowed" });
    }

    await requireOperator(req);

    const body = parseBody(req);

    const claimId = norm(body.claimId);
    const title = norm(body.title) || null;

    const firstName = norm(body.firstName);
    const lastName = norm(body.lastName);
    const address = norm(body.address);
    const postcode = norm(body.postcode);

    const donationDate = norm(body.donationDate);
    const donationAmount = Number(body.donationAmount);

    if (!claimId) return send(res, 400, { ok: false, error: "claimId is required" });
    if (!firstName) return send(res, 400, { ok: false, error: "First Name is required" });
    if (!lastName) return send(res, 400, { ok: false, error: "Last Name is required" });
    if (!address) return send(res, 400, { ok: false, error: "Address is required" });
    if (!postcode) return send(res, 400, { ok: false, error: "Postcode is required" });
    if (!donationDate) return send(res, 400, { ok: false, error: "Donation Date is required" });

    if (!Number.isFinite(donationAmount) || donationAmount <= 0) {
      return send(res, 400, { ok: false, error: "Donation Amount must be a positive number" });
    }

    // ✅ IMPORTANT: satisfy DB NOT NULL constraint
    const donor_name = [title || "", firstName, lastName].filter(Boolean).join(" ").trim();

    // Insert includes BOTH:
    // - legacy donor_name (required in your DB right now)
    // - structured donor_* fields used by your UI
    const { data, error } = await supabaseAdmin
      .from("claim_items")
      .insert({
        claim_id: claimId,

        donor_name, // ✅ fixes your error

        donor_title: title,
        donor_first_name: firstName,
        donor_last_name: lastName,
        donor_address: address,
        donor_postcode: postcode,

        donation_date: donationDate,
        donation_amount: donationAmount,
      })
      .select("id")
      .single();

    if (error) {
      return send(res, 500, { ok: false, error: error.message });
    }

    return send(res, 200, { ok: true, id: data?.id });
  } catch (e: any) {
    return send(res, 500, { ok: false, error: e?.message ?? "Server error" });
  }
}
