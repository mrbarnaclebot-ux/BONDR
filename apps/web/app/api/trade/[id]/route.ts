import type { TradeView } from "@bondr/core/api";
import { rateLimited, sameOrigin } from "@/lib/guard";
import { consentRequired, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

export const dynamic = "force-dynamic";

// The worker's trade ids: 16 random bytes in hex, so a guess finds nothing.
const ID = /^[0-9a-f]{32}$/;
const NO_STORE = { "cache-control": "no-store" };

/** One trade's state from the worker's memory only: no chain or database read (D-04). Another wallet's trade is 404. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  // Same-origin browser GETs carry no Origin, so only a present, foreign one is refused.
  if (req.headers.get("origin") && !sameOrigin(req)) return new Response(null, { status: 403 });
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  // The panel polls about once a second while a trade settles.
  const limited = rateLimited(req, "trade-view", 240, 60_000);
  if (limited) return limited;
  const wallet = sessionWallet(req);
  if (!wallet) return consentRequired();
  const { status, body } = await workerPost<TradeView>("/trade/view", { tradeId: id, wallet });
  return Response.json(body, { status, headers: NO_STORE });
}
