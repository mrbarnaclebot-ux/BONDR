import type { TradePrepareResult } from "@bondr/core/api";
import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { consentRequired, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 1024;
// No wallet: it comes from the session, never the body (CR-01, T2).
const FIELDS = ["side", "mint", "amount", "slippageBps"] as const;

/** Builds the unsigned trade tx for the session wallet in the worker, which re-parses every field. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const wallet = sessionWallet(req);
  // Each prepare spends Helius credits on a simulation; 30 per 10 minutes leaves room for retries after a reject.
  const limited = rateLimited(req, "trade-prepare", 30, 10 * 60_000, wallet ?? undefined);
  if (limited) return limited;
  if (!wallet) return consentRequired();
  const body = (await json(req, MAX_BODY)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ error: "invalid_input" }, { status: 400 });
  const fields = Object.fromEntries(FIELDS.map((k) => [k, body[k]]));
  const { status, body: out } = await workerPost<TradePrepareResult>(
    "/trade/prepare",
    { ...fields, wallet },
    15_000,
  );
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
