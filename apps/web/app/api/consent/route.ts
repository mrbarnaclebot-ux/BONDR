import { db, wallets } from "@/lib/db";
import { BASE58_KEY, json, rateLimited, sameOrigin } from "@/lib/guard";
import { consentRequired, issueNonce, sessionCookie, sessionWallet, verifyConsent } from "@/lib/session";
import { TERMS_VERSION } from "@/lib/terms";

const MAX_BODY = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };

/** This browser's session wallet (or null) and a fresh nonce to sign. The request carries no address. */
export function GET(req: Request): Response {
  return Response.json({ wallet: sessionWallet(req), ...issueNonce() }, { headers: NO_STORE });
}

type Body = { wallet?: unknown; nonce?: unknown; signature?: unknown } | null;

/**
 * Records consent (PLAT-02) once Phantom has signed the consent message, then sets the session the launch
 * routes read the wallet from. The address travels in the body, never the URL, and is never logged.
 */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  // Before the body is read: verifying and the upsert are cheap, but neither should be spammable.
  const limited = rateLimited(req, "consent", 10, 10 * 60_000);
  if (limited) return limited;
  const { wallet, nonce, signature } = ((await json(req, MAX_BODY)) as Body) ?? {};
  if (typeof wallet !== "string" || !BASE58_KEY.test(wallet)) return new Response(null, { status: 400 });
  if (typeof nonce !== "string" || typeof signature !== "string") return new Response(null, { status: 400 });
  // The signature is the proof: the body's wallet counts only because its key signed this nonce.
  if (!verifyConsent(wallet, nonce, Buffer.from(signature, "base64"))) return consentRequired();
  const consentedAt = new Date();
  try {
    await db()
      .insert(wallets)
      .values({ address: wallet, consentedAt, termsVersion: TERMS_VERSION })
      .onConflictDoUpdate({ target: wallets.address, set: { consentedAt, termsVersion: TERMS_VERSION } });
  } catch (e) {
    // Drizzle's error message carries the query params, which include the address: log only the code.
    console.error("consent upsert failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return new Response(null, { status: 503 });
  }
  return new Response(null, { status: 204, headers: { "set-cookie": sessionCookie(wallet), ...NO_STORE } });
}
