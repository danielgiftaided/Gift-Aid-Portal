import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supabaseAdmin } from "../_utils/supabase.js";
import { requireUser } from "../_utils/requireUser.js";

function send(res: VercelResponse, status: number, body: object) {
  return res.status(status).json(body);
}

async function getCharityId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("users")
    .select("charity_id")
    .eq("id", userId)
    .single();
  return data?.charity_id ?? null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const user = await requireUser(req);

    const charityId = await getCharityId(user.id);
    if (!charityId) return send(res, 400, { ok: false, error: "No charity linked to this account" });

    // GET — return full charity profile
    if (req.method === "GET") {
      const { data, error } = await supabaseAdmin
        .from("charities")
        .select("name, contact_email, description, charity_number, charity_id, authorised_official_name, authorised_official_role, address")
        .eq("id", charityId)
        .single();

      if (error) return send(res, 500, { ok: false, error: error.message });

      return send(res, 200, {
        ok: true,
        profile: {
          name: data.name ?? "",
          contact_email: data.contact_email ?? "",
          description: data.description ?? "",
          charity_number: data.charity_number ?? data.charity_id ?? "",
          authorised_official_name: data.authorised_official_name ?? "",
          authorised_official_role: data.authorised_official_role ?? "",
          address: data.address ?? "",
        },
      });
    }

    // POST — update charity profile
    if (req.method === "POST") {
      const b = (req as any).body ?? {};
      const body = typeof b === "string" ? JSON.parse(b) : b;

      const str = (v: any) => String(v ?? "").trim();

      if (!str(body.name)) return send(res, 400, { ok: false, error: "Charity name is required" });

      const updates: Record<string, any> = {
        name: str(body.name),
        contact_email: str(body.contact_email),
        description: str(body.description) || null,
        charity_number: str(body.charity_number) || null,
        authorised_official_name: str(body.authorised_official_name) || null,
        authorised_official_role: str(body.authorised_official_role) || null,
        address: str(body.address) || null,
      };

      const { error } = await supabaseAdmin
        .from("charities")
        .update(updates)
        .eq("id", charityId);

      if (error) return send(res, 500, { ok: false, error: error.message });

      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err: any) {
    return send(res, 401, { ok: false, error: err.message });
  }
}
