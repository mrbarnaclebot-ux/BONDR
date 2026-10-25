import { BASE58_KEY } from "@/lib/guard";
import { firstLedgerPage, ledgerPage, parseLedgerCursor } from "@/lib/ledger";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

/**
 * The next 20 older fee ledger rows of a coin (Load more on the token page); `before` is the page's `next`
 * ("landedMs.id"). Without `before` it is the first page, kept 10 s per mint and hub head (D-04).
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ mint: string }> },
): Promise<Response> {
  const { mint } = await params;
  if (!BASE58_KEY.test(mint))
    return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const raw = new URL(req.url).searchParams.get("before");
  const before = raw === null ? undefined : parseLedgerCursor(raw);
  if (before === null) return Response.json({ error: "invalid_input" }, { status: 400, headers: NO_STORE });
  try {
    const page = before ? await ledgerPage(mint, before) : await firstLedgerPage(mint);
    return Response.json(page, { headers: NO_STORE });
  } catch (e) {
    console.error("ledger read failed", (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return Response.json({ error: "worker_unavailable" }, { status: 503, headers: NO_STORE });
  }
}
