import { json, rateLimited, sameOrigin } from "@/lib/guard";
import { workerPost } from "@/lib/worker";

// A launch wire is at most 1,232 bytes, about 1,650 in base64, plus the 32-character id.
const MAX_BODY = 4 * 1024;
// The worker co-signs, then returns as soon as the RPC accepts the tx; settling runs in its background.
const SUBMIT_TIMEOUT_MS = 20_000;

/** Hands the Phantom-signed wire to the worker. The worker's cosign against its stored message is the gate. */
export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const body = (await json(req, MAX_BODY)) as { launchId?: unknown; signed?: unknown } | null;
  if (!body || typeof body.launchId !== "string" || typeof body.signed !== "string")
    return Response.json({ error: "invalid_input" }, { status: 400 });
  // A submit costs nothing to refuse, so this only blunts a loop; one launch needs one call.
  const limited = rateLimited(req, "submit", 20, 10 * 60_000);
  if (limited) return limited;
  const { status, body: out } = await workerPost(
    "/submit",
    { launchId: body.launchId, signed: body.signed },
    SUBMIT_TIMEOUT_MS,
  );
  return Response.json(out, { status, headers: { "cache-control": "no-store" } });
}
