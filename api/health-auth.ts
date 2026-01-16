import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return await Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms)
    ),
  ]);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const authHeader = req.headers.authorization;

    // If you open in browser directly, no auth header → return immediately (no hanging)
    if (!authHeader) {
      return res.status(401).json({ ok: false, error: "Not authenticated" });
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = assertEnv("SUPABASE_URL");
    // IMPORTANT: for verifying user tokens, use the ANON key, not service_role.
    // We'll read it from env to keep it out of the frontend build pipeline.
    const supabaseAnon = assertEnv("SUPABASE_ANON_KEY");

    const supabase = createClient(supabaseUrl, supabaseAnon);

    const { data, error } = await withTimeout(
      supabase.auth.getUser(token),
      8000,
      "supabase.auth.getUser"
    );

    if (error || !data.user) {
      return res.status(401).json({ ok: false, error: "Invalid session" });
    }

    return res.status(200).json({ ok: true, userId: data.user.id, email: data.user.email });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
