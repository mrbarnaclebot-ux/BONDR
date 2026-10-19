// Request guards for POST route handlers. No server-only import here, so a unit test can load this file.

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
