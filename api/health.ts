import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  // This should NEVER hang. It does not call Supabase.
  return res.status(200).json({
    ok: true,
    message: "health endpoint is running",
    hasAuthHeader: Boolean(req.headers.authorization),
    time: new Date().toISOString(),
  });
}
