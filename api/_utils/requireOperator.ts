import type { VercelRequest } from "@vercel/node";
import { requireUser } from "./requireUser.js";
import { supabaseAdmin } from "./supabase.js";

export async function requireOperator(req: VercelRequest) {
  const user = await requireUser(req);

  const { data: userRow, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (error) throw new Error(error.message);
  if (!userRow || userRow.role !== "operator") {
    throw new Error("Forbidden: operator access required");
  }

  return user;
}
