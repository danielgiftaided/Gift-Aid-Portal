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

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const url = assertEnv("SUPABASE_URL");
    const key = assertEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseAdmin = createClient(url, key);

    // Simple, fast call: read server time. If auth/network is broken, we will timeout quickly.
    const result = await withTimeout(
      supabaseAdmin.from("charities").select("id").limit(1),
      8000,
      "supabase query charities"
    );

    if (result.error) {
      return res.status(500).json({ ok: false, stage: "query", error: result.error.message });
    }

    return res.status(200).json({ ok: true, stage: "query", sample: result.data });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}
