import { supabaseAdmin } from "./supabase.js";

export async function requireUser(req: Request) {
  const authHeader = req.headers.get("authorization");

  if (!authHeader) {
    throw new Error("Not authenticated");
  }

  const token = authHeader.replace("Bearer ", "");

  const { data, error } = await supabaseAdmin.auth.getUser(token);

  if (error || !data.user) {
    throw new Error("Invalid session");
  }

  return data.user;
}
