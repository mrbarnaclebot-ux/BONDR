import { BASE58_KEY } from "@/lib/guard";
import { parseCursor, tradesPage } from "@/lib/trades";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/** The next 50 older trades of a coin (Load more on the token page); `before` is the last row's "slot.seq". */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  if (!BASE58_KEY.test(mint))
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const raw = new URL(req.url).searchParams.get("before");
  const before = raw === null ? undefined : parseCursor(raw);
  if (before === null) return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    return Response.json(await tradesPage(mint, before), { headers: NO_STORE });
  } catch (e) {
    console.error("trades read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
