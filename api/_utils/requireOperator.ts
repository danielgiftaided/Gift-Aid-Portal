import type { VercelRequest } from "@vercel/node";
import { requireUser } from "./requireUser.js";
import { supabaseAdmin } from "./supabase.js";

export async function requireOperator(req: VercelRequest) {
  const user = await requireUser(req);

  const { data: userRow, error } = await supabaseAdmin
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!userRow) {
    throw new Error("Forbidden: your signed-in account has no portal profile. Sign out and sign in with your registered operator account, or ask your administrator to restore your existing profile.");
  }
  if (userRow.role !== "operator") {
    throw new Error("Forbidden: operator access required");
  }

  return user;
}
