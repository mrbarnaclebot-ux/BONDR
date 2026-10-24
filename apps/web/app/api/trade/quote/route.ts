import type { TradeQuote, TradeQuoteRequest } from "@bondr/core/api";
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 1024;

/** Route quote for the trade panel. Public (D-10): only the four quote fields reach the worker, which re-parses them. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  // Typing is debounced 400 ms and the panel refreshes every 2 s, so 120 a minute leaves room for both.
  const limited = rateLimited(req, "trade-quote", 120, 60_000);
  if (limited) return limited;
  const body = (await json(req, MAX_BODY)) as Partial<Record<keyof TradeQuoteRequest, unknown>> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const { side, mint, amount, slippageBps } = body;
  const { status, body: out } = await workerPost<TradeQuote>("/trade/quote", {
    side,
    mint,
    amount,
    slippageBps,
  });
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
