import { db, wallets } from "@/lib/db";
import { BASE58_KEY, json, rateLimited, sameOrigin } from "@/lib/guard";
import { TERMS_VERSION } from "@/lib/terms";

const MAX_BODY = 16 * 1024;

/** Records consent (PLAT-02). The address travels in the body, never the URL, and is never logged. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  // Before the body is read: the upsert is cheap, but the table should not be spammable.
  const limited = rateLimited(req, "consent", 10, 10 * 60_000);
  if (limited) return limited;
  const body = await json(req, MAX_BODY);
  const wallet = (body as { wallet?: unknown } | null)?.wallet;
  if (typeof wallet !== "string" || !BASE58_KEY.test(wallet)) return new Response(null, { status: 400 });
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
  return new Response(null, { status: 204 });
}
