import { requireUser } from "./_utils/authGuard";

export default async function handler(req: Request) {
  try {
    const user = await requireUser(req);
    return new Response(
      JSON.stringify({ ok: true, userId: user.id }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ ok: false, error: err.message }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }
}
