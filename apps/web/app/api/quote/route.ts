import type { Quote } from "@bondr/core/api";
import { json, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 1024;

/** Dev-buy quote. The worker validates solIn and wallet; the browser sends wallet only after consent. */
// ponytail: no rate limit yet, 02-10 adds the per-IP limit here (T-02-08-04).
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const body = (await json(req, MAX_BODY)) as { solIn?: unknown; wallet?: unknown } | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const { status, body: out } = await workerPost<Quote>("/quote", { solIn: body.solIn, wallet: body.wallet });
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
