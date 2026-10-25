// The owner's sign-in (ADMIN-01, D-08 to D-10): a nonce, one Phantom signature over the admin message, then a
// 30-minute bondr_admin cookie. Every call is POST, so sameOrigin always sees an Origin (Pitfall 8).
import { lt } from "drizzle-orm";
import { consentNonces, db } from "@/lib/db";
import { BASE58_KEY, json, rateLimited, sameOrigin } from "@/lib/guard";
import {
  adminCookie,
  adminMessage,
  adminSignOutCookie,
  adminWalletEnv,
  issueNonce,
  verifyAdmin,
} from "@/lib/session";

export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };

type Body = { op?: unknown; wallet?: unknown; nonce?: unknown; signature?: unknown };

const refuse = (status: number, error: string) => Response.json({ error }, { status, headers: NO_STORE });

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const limited = rateLimited(req, "admin-session", 10, 10 * 60_000);
  if (limited) return limited;
  const body = ((await json(req, MAX_BODY)) ?? {}) as Body;
  if (body.op === "signout")
    return new Response(null, { status: 200, headers: { "set-cookie": adminSignOutCookie(), ...NO_STORE } });
  if (typeof body.wallet !== "string" || !BASE58_KEY.test(body.wallet)) return refuse(400, "invalid_input");
  if (body.op === "nonce") {
    const n = issueNonce();
    return Response.json(
      { ...n, message: adminMessage(body.wallet, n.nonce, n.expires) },
      { headers: NO_STORE },
    );
  }
  if (body.op === "verify") return verify(body.wallet, body.nonce, body.signature);
  return refuse(400, "invalid_input");
}

async function verify(wallet: string, nonce: unknown, signature: unknown): Promise<Response> {
  const admin = adminWalletEnv();
  if (!admin) return refuse(403, "not_configured");
  // Before the signature check and the nonce spend: another wallet costs nothing and gets no cookie (D-10).
  if (wallet !== admin) return refuse(403, "not_admin");
  if (typeof nonce !== "string" || typeof signature !== "string") return refuse(400, "invalid_input");
  const expiresAt = verifyAdmin(wallet, nonce, Buffer.from(signature, "base64"));
  if (!expiresAt) return refuse(401, "bad_signature");
  try {
    const fresh = await db()
      .insert(consentNonces)
      .values({ nonce, expiresAt })
      .onConflictDoNothing()
      .returning({ nonce: consentNonces.nonce });
    if (fresh.length === 0) return refuse(401, "bad_signature"); // a replayed signature
    await db().delete(consentNonces).where(lt(consentNonces.expiresAt, new Date()));
  } catch (e) {
    // Drizzle's error message carries the query params: log only the code.
    console.error(
      "admin sign-in write failed",
      (e as { cause?: { code?: string } }).cause?.code ?? "unknown",
    );
    return new Response(null, { status: 503 });
  }
  const { header, exp } = adminCookie(wallet);
  return Response.json({ wallet, exp }, { headers: { "set-cookie": header, ...NO_STORE } });
}
