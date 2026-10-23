import { launchView } from "@/lib/launches";

export const dynamic = "force-dynamic";

// The worker's launch ids: 16 random bytes in hex, so a guess finds nothing and the wallet is never in a URL.
const ID = /^[0-9a-f]{32}$/;
const NO_STORE = { "cache-control": "no-store" };

/** One launch's public fields, read from the database (step 4 polls this every second; no worker call). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  if (!ID.test(id)) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  try {
    const view = await launchView(id);
    if (!view) return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return Response.json(view, { headers: NO_STORE });
  } catch (e) {
    console.error("launch read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
