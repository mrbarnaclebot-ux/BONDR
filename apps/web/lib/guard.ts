// Request guards for POST route handlers. No Next-only imports, so a unit test can load this file.

/**
 * CSRF guard: the browser sets Origin on every POST and a page cannot forge it, so a cross-site form or
 * fetch fails here. Railway's proxy passes the public host in X-Forwarded-Host.
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Reads a JSON body of at most maxBytes; null on a wrong content type, too large or bad JSON. Requiring
 * application/json also keeps simple cross-site forms out (they cannot send it without a preflight).
 */
export async function json(req: Request, maxBytes: number): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  // Streamed so a body without Content-Length still stops at the cap instead of filling memory.
  for (let part = await reader.read(); !part.done; part = await reader.read()) {
    size += part.value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(part.value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

// A Solana public key in base58: 32 bytes encode to 32-44 characters of this alphabet.
export const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

// ponytail: per-instance memory while web runs one replica; move to a Postgres counter if web scales out.
// Each entry keeps its own end time, so a sweep never cuts short a scope with a longer window.
const hits = new Map<string, { end: number; n: number }>();
const MAX_KEYS = 10_000;

/** Fixed window. Seconds to wait when key is over limit, else null. */
export function take(key: string, now: number, limit: number, windowMs: number): number | null {
  let h = hits.get(key);
  if (!h || now >= h.end) {
    if (hits.size >= MAX_KEYS) for (const [k, v] of hits) if (now >= v.end) hits.delete(k);
    // Still full of live windows: drop the oldest (a Map keeps insertion order), so memory stays bounded.
    if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value as string);
    h = { end: now + windowMs, n: 0 };
    hits.set(key, h);
  }
  h.n++;
  return h.n > limit ? Math.max(1, Math.ceil((h.end - now) / 1000)) : null;
}

/**
 * Railway's edge sets X-Real-IP to the client's address (docs.railway.com, public networking specs and limits);
 * otherwise the rightmost X-Forwarded-For entry, the one our proxy added.
 */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").at(-1)?.trim() || null;
}

/**
 * Counts the request against the IP, then, only if the IP is under its limit, the wallet; a 429 when either is
 * over, else null. An IP over its limit never adds wallet keys (web WR-01).
 */
export function rateLimited(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number,
  wallet?: string,
): Response | null {
  // No address (a deploy path without the proxy headers) shares one bucket: limited, never unlimited (WR-03).
  const ip = clientIp(req) ?? "unknown";
  const now = Date.now();
  const ipWait = take(`${scope}:ip:${ip}`, now, limit, windowMs);
  const wait = ipWait ?? (wallet ? take(`${scope}:wallet:${wallet}`, now, limit, windowMs) : null);
  if (wait === null) return null;
  return Response.json(
    { error: "rate_limited" },
    { status: 429, headers: { "retry-after": String(wait), "cache-control": "no-store" } },
  );
}
