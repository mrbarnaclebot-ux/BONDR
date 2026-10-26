import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { adminSession, adminWalletEnv, consentRequired, pinnedHere, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

const MAX_BODY = 16 * 1024;
// Measured on devnet from the Mac (02-11): about 10 s when the wallet's table is reused, about 18 s when the
// worker creates it (two paced table txs plus warm-up).
const PREPARE_TIMEOUT_MS = 30_000;
// No wallet: it comes from the session, never the body (CR-01).
const FIELDS = ["name", "symbol", "description", "links", "uri", "imageCid", "solIn", "exit"] as const;

/** Builds the unsigned launch tx (a PrepareResult) in the worker. The worker re-checks every field, consent and the pause. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const wallet = sessionWallet(req);
  // Each new reservation can cost ops a lookup table; 10 leaves room for Try again after a Phantom rejection.
  const limited = rateLimited(req, "prepare", 10, 10 * 60_000, wallet ?? undefined);
  if (limited) return limited;
  if (!wallet) return consentRequired();
  const body = (await json(req, MAX_BODY)) as Record<string, unknown> | null;
  // The uri and image must be the ones the pin route built, never a hand-pinned JSON (worker-core WR-06).
  if (!body || !pinnedHere(body.proof, body.uri, body.imageCid))
    return Response.json({ error: "invalid_input" }, { status: 400 });
  const fields = Object.fromEntries(FIELDS.map((k) => [k, body[k]]));
  // D-29: actor only from a valid admin cookie, spread last so no body can forge it (FIELDS never names it).
  // The worker treats it as a genesis prepare and re-checks it against ADMIN_WALLET.
  const admin = adminSession(req.headers.get("cookie"), adminWalletEnv());
  const forward = { ...fields, wallet, ...(admin ? { actor: admin.wallet } : {}) };
  const { status, body: out } = await workerPost("/prepare", forward, PREPARE_TIMEOUT_MS);
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
