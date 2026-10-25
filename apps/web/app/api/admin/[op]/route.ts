// The one door into admin (D-11): a same-origin POST with a live bondr_admin cookie, checked before the rate
// limit and before any body is read. Every admin call is POST, so sameOrigin always sees an Origin (Pitfall 8).
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { adminSession, adminWalletEnv } from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };

type Session = { wallet: string; exp: number };

// Later plans add one entry per op. The actor sent to the worker is always s.wallet from the cookie, never a
// field of the body.
const OPS: Record<string, (body: Record<string, unknown>, s: Session) => Promise<Response>> = {};

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const s = adminSession(req.headers.get("cookie"), adminWalletEnv());
  if (!s) return Response.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  const { op } = await params;
  const limited = rateLimited(req, `admin:${op}`, 60, 60_000, s.wallet);
  if (limited) return limited;
  const body = await json(req, MAX_BODY);
  const run = Object.hasOwn(OPS, op) ? OPS[op] : undefined;
  if (!run) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  return run(body && typeof body === "object" ? (body as Record<string, unknown>) : {}, s);
}
