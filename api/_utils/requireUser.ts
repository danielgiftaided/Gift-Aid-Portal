import { createClient } from "@supabase/supabase-js";
import type { VercelRequest } from "@vercel/node";

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

export async function requireUser(req: VercelRequest) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new Error("Not authenticated");
  }

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    assertEnv("SUPABASE_URL"),
    assertEnv("SUPABASE_ANON_KEY")
  );

  const { data, error } = await withTimeout(
    supabase.auth.getUser(token),
    8000,
    "supabase.auth.getUser"
  );

  if (error || !data.user) {
    throw new Error("Invalid session");
  }

  return data.user;
}
