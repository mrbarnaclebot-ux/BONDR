// The owner console's one Postgres load (D-21): W rows, platform totals, the vanity pool and the latest
// reconcile diffs, plus the worker's chain balances and coin memory, in one Promise.all. It runs from the
// /admin page render and the overview op (Refresh, after an action) only, never from a timer, so Neon can
// suspend with the console open (D-02). No `kept` cache: a read must reflect an action that just settled.
import "server-only";
import type { AdminOverviewWorker } from "@bondr/core/api-admin";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { Reconcile, Totals } from "./admin-copy-health";
import { coins, db, feeLedger, launches, vanityMints } from "./db";
import { workerPost } from "./worker";

export type WRow = {
  mint: string;
  symbol: string;
  name: string;
  image: string | null; // the IPFS image CID, as CoinRow.imageCid
  w: string;
  venue: "curve" | "complete" | "pool";
  finalize: "none" | "held" | "done";
  feeBudget: string;
  feesUnclaimed: string;
  cost: string | null;
  launchedAt: string;
  lastCollectAt: string | null;
  heldAt: string | null;
  heldReason: string | null;
  bondSent: boolean;
  bondedAt: string | null;
  launch: "landed" | "unconfirmed";
};

export type AdminOverview = {
  rows: WRow[];
  totals: Totals;
  vanityFree: number;
  reconcile: Reconcile;
  worker: AdminOverviewWorker | null; // null when the worker did not answer: panels show failed, never zeros
  loadedAt: number; // 0 when the load failed (emptyOverview)
};

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

// ponytail: every coin in one read; page the W table when coins pass a few thousand.
async function coinRows(): Promise<WRow[]> {
  const found = await db()
    .select({
      ...{ mint: coins.mint, symbol: launches.symbol, name: launches.name, image: launches.imageCid },
      ...{ w: launches.w, venue: coins.venue, finalize: coins.finalize, feeBudget: coins.feeBudget },
      ...{ feesUnclaimed: coins.feesUnclaimed, cost: coins.costToComplete, launchedAt: coins.launchedAt },
      lastCollectAt: sql<Date | null>`(select max(f.landed_at) from fee_ledger f
        where f.mint = ${coins.mint} and f.kind = 'collect' and f.state = 'landed')`.mapWith(
        feeLedger.landedAt,
      ),
      ...{ heldAt: coins.heldAt, heldReason: coins.heldReason, bondedAt: coins.bondedAt },
      // A bond burn signed but not yet confirmed (D-24 "Bond sent").
      bondSent: sql<boolean>`exists(select 1 from fee_ledger f where f.mint = ${coins.mint}
        and f.kind in ('forced_bond','pool_burn') and f.state = 'pending')`,
    })
    .from(coins)
    .innerJoin(launches, eq(launches.id, coins.launchId));
  return found.map((r) => ({
    ...r,
    venue: r.venue as WRow["venue"],
    finalize: r.finalize as WRow["finalize"],
    launchedAt: r.launchedAt.toISOString(),
    lastCollectAt: isoOrNull(r.lastCollectAt),
    heldAt: isoOrNull(r.heldAt),
    bondedAt: isoOrNull(r.bondedAt),
    launch: "landed" as const,
  }));
}

// A launch in flight with no coin row yet: the owner sees it as "Launch unconfirmed" and can re-check it.
async function unconfirmedRows(): Promise<WRow[]> {
  const found = await db()
    .select({
      ...{ mint: launches.mint, symbol: launches.symbol, name: launches.name, image: launches.imageCid },
      ...{ w: launches.w, createdAt: launches.createdAt },
    })
    .from(launches)
    .where(
      and(
        inArray(launches.state, ["signed", "sent", "unknown"]),
        notExists(db().select({ one: sql`1` }).from(coins).where(eq(coins.mint, launches.mint))),
      ),
    );
  return found.map(({ createdAt, ...r }) => ({
    ...r,
    ...{ venue: "curve" as const, finalize: "none" as const, feeBudget: "0", feesUnclaimed: "0", cost: null },
    ...{ launchedAt: createdAt.toISOString(), lastCollectAt: null, heldAt: null, heldReason: null },
    ...{ bondSent: false, bondedAt: null, launch: "unconfirmed" as const },
  }));
}

async function totals(): Promise<Totals> {
  const [t] = await db()
    .select({
      coins: sql<number>`count(*)::int`,
      bonded: sql<number>`(count(*) filter (where ${coins.venue} <> 'curve'))::int`,
      volume30d: sql<string>`(select coalesce(sum(t.sol), 0)::text from trades t
        where t.side <> 'burn' and t.at > now() - interval '30 days')`,
      treasury30d: sql<string>`(select coalesce(sum(l.sol), 0)::text from fee_ledger l where l.state = 'landed'
        and l.kind in ('split_treasury','sweep_treasury','evacuate') and l.landed_at > now() - interval '30 days')`,
    })
    .from(coins);
  return t;
}

// The `ready` predicate behind apps/worker/src/vanity.ts poolSize, repeated because web cannot import the
// worker: unused, not reserved, and no launch of it that may still land (D-28).
const VANITY_FREE = sql`${vanityMints.usedAt} is null
  and (${vanityMints.reservedUntil} is null or ${vanityMints.reservedUntil} < now())
  and not exists (select 1 from ${launches} where ${launches.mint} = ${vanityMints.pubkey}
    and (${launches.state} in ('signed','sent','unknown','landed')
      or (${launches.state} = 'prepared' and ${launches.createdAt} > now() - interval '2 minutes')))`;

// ponytail: the newest diff per account from the last 7 days. Reconcile writes a row only when a diff first
// appears (WR-09), so a fixed diff lingers up to a week rather than a persistent one reading Clean; report the
// worker's live diff set in health if that misleads.
async function reconcile(): Promise<Reconcile> {
  const account = sql`coalesce(${feeLedger.mint}, '')`;
  const rows = await db()
    .selectDistinctOn([account], {
      symbol: launches.symbol,
      diff: sql<string>`${feeLedger.detail}->>'diff'`,
      at: feeLedger.createdAt,
    })
    .from(feeLedger)
    .leftJoin(coins, eq(coins.mint, feeLedger.mint))
    .leftJoin(launches, eq(launches.id, coins.launchId))
    .where(and(eq(feeLedger.kind, "reconcile_diff"), sql`${feeLedger.createdAt} > now() - interval '7 days'`))
    .orderBy(account, desc(feeLedger.createdAt));
  const first = rows.sort((a, b) => b.at.getTime() - a.at.getTime())[0];
  return {
    count: rows.length,
    first: first ? { symbol: first.symbol ?? "Buyback", bondr: first.diff ?? "0" } : null,
  };
}

async function workerOverview(actor: string): Promise<AdminOverviewWorker | null> {
  const r = await workerPost<AdminOverviewWorker>("/admin/overview", { actor });
  return r.status === 200 ? (r.body as AdminOverviewWorker) : null;
}

/** Everything the console's DB-backed panels show; the actor is the signed-in admin wallet. */
export async function overviewData(actor: string): Promise<AdminOverview> {
  const [landed, unconfirmed, t, vanityFree, diffs, worker] = await Promise.all([
    coinRows(),
    unconfirmedRows(),
    totals(),
    db().$count(vanityMints, VANITY_FREE),
    reconcile(),
    workerOverview(actor),
  ]);
  const rows = [...unconfirmed, ...landed].sort((a, b) => b.launchedAt.localeCompare(a.launchedAt));
  return { rows, totals: t, vanityFree, reconcile: diffs, worker, loadedAt: Date.now() };
}

/** What the page renders when the load failed: loadedAt 0 marks it, so panels show their failed state. */
export const emptyOverview = (): AdminOverview => ({
  rows: [],
  totals: { coins: 0, bonded: 0, volume30d: "0", treasury30d: "0" },
  vanityFree: 0,
  reconcile: { count: 0, first: null },
  worker: null,
  loadedAt: 0,
});
