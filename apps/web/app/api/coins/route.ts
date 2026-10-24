import { heroCounts, listCoins, parsePage, parseQ, parseSort, trending } from "@/lib/coins";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * One page of the home grid (tab switch, search, Show more): sort top, latest or oldest, page 0-99, q to 64.
 * `trending=1` adds Trending and the hero counts, so the home page's resync catch-up is one request (every read
 * is kept 10 s).
 */
export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const sort = parseSort(q.get("sort"));
  const page = parsePage(q.get("page"));
  const text = parseQ(q.get("q"));
  if (sort === null || page === null || text === null)
    return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    const resync = q.get("trending") === "1";
    const [list, trend, counts] = await Promise.all([
      listCoins({ sort, page, q: text }),
      resync ? trending() : undefined,
      resync ? heroCounts() : undefined,
    ]);
    return Response.json({ ...list, trending: trend, counts }, { headers: NO_STORE });
  } catch (e) {
    console.error("coins read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
