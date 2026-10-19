import { BASE58_KEY, json, rateLimited, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 16 * 1024;
// Measured on devnet from the Mac (02-11): about 10 s when the wallet's table is reused, about 18 s when the
// worker creates it (two paced table txs plus warm-up).
const PREPARE_TIMEOUT_MS = 30_000;
const FIELDS = [
  "wallet",
  "name",
  "symbol",
  "description",
  "links",
  "uri",
  "imageCid",
  "solIn",
  "exit",
] as const;

/** Builds the unsigned launch tx (a PrepareResult) in the worker. The worker re-checks every field, consent and the pause. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const body = (await json(req, MAX_BODY)) as Record<string, unknown> | null;
  const wallet = body?.wallet;
  if (!body || typeof wallet !== "string" || !BASE58_KEY.test(wallet))
    return Response.json({ error: "invalid_input" }, { status: 400 });
  // Each new reservation can cost ops a lookup table; 10 leaves room for Try again after a Phantom rejection.
  const limited = rateLimited(req, "prepare", 10, 10 * 60_000, wallet);
  if (limited) return limited;
  const fields = Object.fromEntries(FIELDS.map((k) => [k, body[k]]));
  const { status, body: out } = await workerPost("/prepare", fields, PREPARE_TIMEOUT_MS);
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
