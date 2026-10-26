// The one door into admin (D-11): a same-origin POST with a live bondr_admin cookie, checked before the rate
// limit and before any body is read. Every admin call is POST, so sameOrigin always sees an Origin (Pitfall 8).

import type { AdminCoinLive } from "@bondr/core/api-admin";
import { auditPage, parseAuditCursor } from "@/lib/admin-audit-page";
import { overviewData } from "@/lib/admin-data";
import { coinTimeline } from "@/lib/admin-timeline-data";
import { BASE58_KEY, json, rateLimited, sameOrigin } from "@/lib/guard";
import { adminSession, adminWalletEnv } from "@/lib/session";
import { workerPost } from "@/lib/worker";

export const dynamic = "force-dynamic";

const MAX_BODY = 16 * 1024;
const NO_STORE = { "cache-control": "no-store" };

type Session = { wallet: string; exp: number };
type Body = Record<string, unknown>;
type Op = (body: Body, s: Session) => Promise<Response>;

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

// Pitfall 14: the web reaches only the worker routes named here; any other op is 404.
const FORWARD: Record<string, string> = {
  health: "/admin/health",
  "contract-check": "/admin/contract-check",
  "coin-live": "/admin/coin-live",
  switch: "/admin/switch",
  act: "/admin/act",
  simulate: "/admin/simulate",
  execute: "/admin/execute",
  intent: "/admin/intent",
  moderate: "/admin/moderate",
  inspect: "/admin/inspect",
};

// execute signs and sends; EVACUATE simulates every batch (at most 8 at a time), so hundreds of W need far
// longer than the 15 s default before the web gives up with worker_unavailable. The contract check makes about
// four RPC reads, which a slow RPC can push past 15 s.
function timeoutOf(op: string, body: Body): number | undefined {
  if (op === "execute" || op === "contract-check") return 30_000;
  if (op === "simulate" && body.action === "evacuate") return 90_000;
  return undefined;
}

// A failed read logs only the driver's error code, never the query or its parameters.
async function read(name: string, fn: () => Promise<unknown>): Promise<Response> {
  try {
    return reply(await fn());
  } catch (e) {
    console.error(`admin ${name} failed`, (e as { cause?: { code?: string } }).cause?.code ?? "unknown");
    return reply({ error: "worker_unavailable" }, 503);
  }
}

// Postgres reads answered by the web itself. Later plans add entries here only.
const LOCAL: Record<string, Op> = {
  overview: (_b, s) => read("overview", () => overviewData(s.wallet)),
  // The first page rides in the overview; this answers the older ones (T-06-14-05).
  audit: async (b) => {
    const before = typeof b.before === "string" ? parseAuditCursor(b.before) : null;
    if (!before) return reply({ error: "invalid_input" }, 400);
    return read("audit", () => auditPage(before));
  },
  // One request per selection (D-21): the coin's DB timeline and the worker's live W read. live is null when the
  // worker did not answer or does not hold the coin (FEE_ENGINE off), so the panel still shows the history.
  coin: async (b, s) => {
    const mint = typeof b.mint === "string" && BASE58_KEY.test(b.mint) ? b.mint : null;
    if (!mint) return reply({ error: "invalid_input" }, 400); // T-06-17-03: before any read
    return read("coin", async () => {
      const [timeline, r] = await Promise.all([
        coinTimeline(mint),
        workerPost<AdminCoinLive>(FORWARD["coin-live"], { mint, actor: s.wallet }),
      ]);
      return { timeline, live: r.status === 200 ? (r.body as AdminCoinLive) : null };
    });
  },
};

// The body spreads first and the cookie's wallet lands last, so a body actor never reaches the worker (D-11).
async function forward(op: string, body: Body, s: Session): Promise<Response> {
  const r = await workerPost(FORWARD[op], { ...body, actor: s.wallet }, timeoutOf(op, body));
  return reply(r.body, r.status);
}

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }): Promise<Response> {
  if (!sameOrigin(req)) return new Response(null, { status: 403 });
  const s = adminSession(req.headers.get("cookie"), adminWalletEnv());
  if (!s) return reply({ error: "unauthorized" }, 401);
  const { op } = await params;
  const limited = rateLimited(req, `admin:${op}`, 60, 60_000, s.wallet);
  if (limited) return limited;
  const raw = await json(req, MAX_BODY);
  const body = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Body) : {};
  if (Object.hasOwn(FORWARD, op)) return forward(op, body, s);
  if (Object.hasOwn(LOCAL, op)) return LOCAL[op](body, s);
  return reply({ error: "not_found" }, 404);
}
