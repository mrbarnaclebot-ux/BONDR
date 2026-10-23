import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { launchWallet } from "@/lib/launches";
import { consentRequired, sessionWallet } from "@/lib/session";
import { workerPost } from "@/lib/worker";

// A launch wire is at most 1,232 bytes, about 1,650 in base64, plus the 32-character id.
const MAX_BODY = 4 * 1024;
// The worker co-signs, then returns as soon as the RPC accepts the tx; settling runs in its background.
const SUBMIT_TIMEOUT_MS = 20_000;

/** Hands the Phantom-signed wire to the worker. The worker's cosign against its stored message is the gate. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  // A submit costs nothing to refuse, so this only blunts a loop; one launch needs one call.
  const limited = rateLimited(req, "submit", 20, 10 * 60_000);
  if (limited) return limited;
  const wallet = sessionWallet(req);
  if (!wallet) return consentRequired();
  const body = (await json(req, MAX_BODY)) as { launchId?: unknown; signed?: unknown } | null;
  if (!body || typeof body.launchId !== "string" || typeof body.signed !== "string")
    return Response.json({ error: "invalid_input" }, { status: 400 });
  if (!(await owns(body.launchId, wallet))) return consentRequired();
  const { status, body: out } = await workerPost(
    "/submit",
    { launchId: body.launchId, signed: body.signed },
    SUBMIT_TIMEOUT_MS,
  );
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}

// Another wallet's launch means the session changed since prepare. A failed read is left to the worker,
// whose cosign checks the dev signature against the row's wallet anyway.
async function owns(launchId: string, wallet: string): Promise<boolean> {
  const owner = await launchWallet(launchId).catch(() => null);
  return owner === null || owner === wallet;
}
