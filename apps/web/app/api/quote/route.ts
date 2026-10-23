import type { Quote } from "@bondr/core/api";
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 1024;

/** Dev-buy quote. The worker validates solIn and wallet; the browser sends wallet only after consent. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  // Each quote is a worker RPC read; 60 a minute is far above the 400 ms debounced typing of one person.
  const limited = rateLimited(req, "quote", 60, 60_000);
  if (limited) return limited;
  const body = (await json(req, MAX_BODY)) as { solIn?: unknown; wallet?: unknown } | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const { status, body: out } = await workerPost<Quote>("/quote", { solIn: body.solIn, wallet: body.wallet });
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
