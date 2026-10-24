import type { TradeBalance } from "@bondr/core/api";
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { consentRequired, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 1024;

/** The session wallet's SOL and coin balance (D-16). The wallet comes from the session cookie, never the body. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const wallet = sessionWallet(req);
  // Fetched on connect, on return to the tab and after a trade, never on a timer, so 30 a minute is generous.
  const limited = rateLimited(req, "trade-balance", 30, 60_000, wallet ?? undefined);
  if (limited) return limited;
  if (!wallet) return consentRequired();
  const body = (await json(req, MAX_BODY)) as { mint?: unknown } | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const { status, body: out } = await workerPost<TradeBalance>("/trade/balance", { mint: body.mint, wallet });
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
