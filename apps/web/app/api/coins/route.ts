import { listCoins, parsePage, parseQ, parseSort, trending } from "@/lib/coins";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * One page of the home grid (tab switch, search, Show more): sort top, latest or oldest, page 0-99, q to 64.
 * `trending=1` adds Trending, so the home page's resync catch-up is one request (both reads are kept 10 s).
 */
export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const sort = parseSort(q.get("sort"));
  const page = parsePage(q.get("page"));
  const text = parseQ(q.get("q"));
  if (sort === null || page === null || text === null)
    return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    const [list, trend] = await Promise.all([
      listCoins({ sort, page, q: text }),
      q.get("trending") === "1" ? trending() : undefined,
    ]);
    return Response.json({ ...list, trending: trend }, { headers: NO_STORE });
  } catch (e) {
    console.error("coins read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
