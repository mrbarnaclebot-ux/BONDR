import { BASE58_KEY } from "@/lib/guard";
import { bondTime, candles, parseInterval } from "@/lib/trades";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** The token page chart: market cap candles for `interval` (1m, 5m, 1h, 1d) and the bond time in seconds. */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  if (!BASE58_KEY.test(mint))
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const seconds = parseInterval(new URL(req.url).searchParams.get("interval") ?? "");
  if (!seconds) return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    const [rows, bond] = await Promise.all([candles(mint, seconds), bondTime(mint)]);
    return Response.json({ candles: rows, bondTime: bond }, { headers: NO_STORE });
  } catch (e) {
    console.error("candles read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
