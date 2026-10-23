import { listCoins, parsePage, parseSort } from "@/lib/coins";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** One page of the home grid (tab switch and Show more): sort top, latest or oldest, page 0-99. */
export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const sort = parseSort(q.get("sort"));
  const page = parsePage(q.get("page"));
  if (sort === null || page === null)
    return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await listCoins({ sort, page }), { headers: NO_STORE });
  } catch (e) {
    console.error("coins read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
