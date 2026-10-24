import type { TradeView } from "@bondr/core/api";
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { consentRequired, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

// A trade wire is at most 1,232 bytes, about 1,650 in base64, plus the 32-character id.
const MAX_BODY = 4 * 1024;
// The worker returns once the RPC accepts the tx; settling runs in its background.
const SUBMIT_TIMEOUT_MS = 20_000;

/** Hands the Phantom-signed wire to the worker. Its byte compare and signer check against the stored trade decide (T3). */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const wallet = sessionWallet(req);
  const limited = rateLimited(req, "trade-submit", 30, 10 * 60_000, wallet ?? undefined);
  if (limited) return limited;
  if (!wallet) return consentRequired();
  const body = (await json(req, MAX_BODY)) as { tradeId?: unknown; signed?: unknown } | null;
  if (!body || typeof body.tradeId !== "string" || typeof body.signed !== "string")
    return Response.json({ error: "invalid_input" }, { status: 400 });
  const { status, body: out } = await workerPost<TradeView>(
    "/trade/submit",
    { tradeId: body.tradeId, signed: body.signed, wallet },
    SUBMIT_TIMEOUT_MS,
  );
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
