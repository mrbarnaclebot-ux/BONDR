// Fee ledger rows (D-08, D-23). Every engine tx is recorded pending, with its signature, before it is
// broadcast; the partial unique indexes then refuse a second sweep, split or bond burn. Landing a row moves the
// coin's fee columns in the same database transaction.
import type { LedgerKind, LedgerState } from "@bondr/core/api";
import { coins, type Db, db, feeLedger } from "@bondr/core/db";
import { type LandedRow, type TotalColumn, type Totals, totalsFor } from "@bondr/core/fees";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";
import { type Implied, pgImplied } from "./fee-reconcile.ts";

export type NewEntry = {
  kind: LedgerKind;
  mint: string | null;
  amount?: bigint;
  burned?: bigint;
  sol?: bigint;
  windowIndex?: number;
  ref?: number;
  detail?: Record<string, unknown>;
};
export type Entry = NewEntry & {
  id: number;
  state: LedgerState | null;
  signature: string | null;
  lastValidBlockHeight: bigint | null;
  error: string | null;
  landedAt: Date | null;
};
export type Facts = Partial<Record<LedgerKind, Partial<NewEntry>>>;
export type Settled = "landed" | "failed" | "expired";
export type SettleOpts = { facts?: Facts; slot?: bigint; error?: string };

export type LedgerStore = {
  // null: a unique rule refused the intent and nothing was written.
  insertPending(rows: NewEntry[], sig: string, lastValidBlockHeight: bigint): Promise<Entry[] | null>;
  // Moves only this signature's pending rows; returns them as settled.
  settle(sig: string, to: Settled, o?: SettleOpts): Promise<Entry[]>;
  pending(): Promise<Entry[]>;
  pendingFor(mint: string, kinds: LedgerKind[]): Promise<Entry[]>; // the mint's pending rows of the kinds
  openCollects(mint?: string): Promise<Entry[]>; // landed collects with no live split referencing them
  // A live (pending or landed) row of the kinds, in one window when given (the leftover sweep's free index, A9).
  has(mint: string, kinds: LedgerKind[], windowIndex?: number): Promise<boolean>;
  // Retry sweep: the oldest failed or expired sweep row whose window holds no live sweep of its kind.
  failedSweep(mint: string): Promise<Entry | null>;
  hold(mint: string, reason: string): Promise<void>;
  release(mint: string): Promise<void>; // held -> none; the held row stays as history
  markFinal(mint: string, deployerBps: number): Promise<void>; // done with no landed update (shares already locked)
  diff(mint: string | null, detail: Record<string, unknown>): Promise<void>;
  implied(): Promise<Implied>; // ledger-implied BONDR per W and for the buyback (D-21)
};

export const factsOf = (f: Partial<NewEntry> = {}): Partial<NewEntry> => {
  const { amount, burned, sol, detail } = f;
  return Object.fromEntries(
    Object.entries({ amount, burned, sol, detail }).filter(([, v]) => v !== undefined),
  );
};

type Conn = Pick<Db, "select" | "insert" | "update" | "transaction" | "execute">;
type Row = typeof feeLedger.$inferSelect;

const big = (s: string | null): bigint | undefined => (s === null ? undefined : BigInt(s));
const str = (x: bigint | undefined): string | undefined => (x === undefined ? undefined : String(x));

const toEntry = (r: Row): Entry => ({
  ...{ id: r.id, kind: r.kind as LedgerKind, mint: r.mint, state: r.state as LedgerState | null },
  ...{ amount: big(r.amount), burned: big(r.burned), sol: big(r.sol) },
  ...{ windowIndex: r.windowIndex ?? undefined, ref: r.ref ?? undefined },
  detail: (r.detail as Record<string, unknown> | null) ?? undefined,
  ...{ signature: r.signature, lastValidBlockHeight: r.lastValidBlockHeight, error: r.error },
  landedAt: r.landedAt,
});

const cols = (n: Partial<NewEntry>) => ({
  ...{ amount: str(n.amount), burned: str(n.burned), sol: str(n.sol) },
  ...{ windowIndex: n.windowIndex, ref: n.ref, detail: n.detail },
});

// drizzle wraps the driver error, so the SQLSTATE sits in cause.code.
const sqlState = (e: unknown): string | undefined => {
  const err = e as { code?: string; cause?: { code?: string } };
  return err.cause?.code ?? err.code;
};

const COLS = {
  fee_budget: "feeBudget",
  to_buyback: "toBuyback",
  to_buyback_sol: "toBuybackSol",
  to_treasury: "toTreasury",
  to_treasury_sol: "toTreasurySol",
  bond_spent: "bondSpent",
  bond_spent_sol: "bondSpentSol",
  bond_burned: "bondBurned",
  deployer_earned: "deployerEarned",
  deployer_earned_sol: "deployerEarnedSol",
} as const satisfies Record<TotalColumn, keyof typeof coins.$inferSelect>;

function merge(list: Totals[]): Totals {
  const add: Totals["add"] = {};
  for (const t of list)
    for (const [c, x] of Object.entries(t.add) as [TotalColumn, bigint][]) add[c] = (add[c] ?? 0n) + x;
  return { add, set: Object.assign({}, ...list.map((t) => t.set ?? {})) };
}

// fee_budget clamps at 0: BONDR sent to W outside the ledger must never fail a settle (reconcile reports it).
// fees_unclaimed resets only if no later trade has written it since the collect's slot (Pitfall 3).
function coinSet(t: Totals, slot?: bigint): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [c, x] of Object.entries(t.add) as [TotalColumn, bigint][]) {
    const col = coins[COLS[c]];
    set[COLS[c]] =
      c === "fee_budget"
        ? sql`greatest(0, ${col} + ${String(x)}::bigint)`
        : sql`${col} + ${String(x)}::bigint`;
  }
  const s = slot === undefined ? null : String(slot);
  if (t.set?.feesUnclaimed === 0n)
    set.feesUnclaimed = sql`case when ${s}::bigint is null or ${coins.lastSlot} is null
      or ${coins.lastSlot} <= ${s}::bigint then 0 else ${coins.feesUnclaimed} end`;
  if (t.set?.finalize) set.finalize = t.set.finalize;
  if (t.set?.deployerBps !== undefined) set.deployerBps = t.set.deployerBps;
  return set;
}

async function applyTotals(tx: Conn, rows: Row[], slot?: bigint): Promise<void> {
  const byMint = Map.groupBy(
    rows.filter((r) => r.mint),
    (r) => r.mint as string,
  );
  for (const [mint, list] of byMint) {
    const landed = (r: Row): LandedRow => ({ ...toEntry(r), detail: r.detail as LandedRow["detail"] });
    const set = coinSet(merge(list.map((r) => totalsFor(r.kind as LedgerKind, landed(r)))), slot);
    if (Object.keys(set).length)
      await tx
        .update(coins)
        .set(set as PgUpdateSetSource<typeof coins>)
        .where(eq(coins.mint, mint));
  }
}

async function withFacts(tx: Conn, r: Row, f: Partial<NewEntry> | undefined): Promise<Row> {
  const set = factsOf(f);
  if (!Object.keys(set).length) return r;
  const [u] = await tx.update(feeLedger).set(cols(set)).where(eq(feeLedger.id, r.id)).returning();
  return u ?? r;
}

async function pgInsert(c: Conn, news: NewEntry[], sig: string, lvbh: bigint): Promise<Entry[] | null> {
  const values = news.map((n) => ({
    ...cols(n),
    ...{ kind: n.kind, mint: n.mint, state: "pending", signature: sig, lastValidBlockHeight: lvbh },
  }));
  try {
    // A transaction (a savepoint inside a caller's) so a refused insert leaves the caller usable.
    const rows = await c.transaction((tx) => tx.insert(feeLedger).values(values).returning());
    return rows.map(toEntry);
  } catch (e) {
    if (sqlState(e) === "23505") return null;
    throw e;
  }
}

async function pgSettle(c: Conn, sig: string, to: Settled, o: SettleOpts): Promise<Entry[]> {
  const rows = await c.transaction(async (tx) => {
    const moved = await tx
      .update(feeLedger)
      .set({ state: to, landedAt: to === "landed" ? sql`now()` : null, error: o.error ?? null })
      .where(and(eq(feeLedger.signature, sig), eq(feeLedger.state, "pending")))
      .returning();
    if (to !== "landed") return moved;
    const out: Row[] = [];
    for (const r of moved) out.push(await withFacts(tx, r, o.facts?.[r.kind as LedgerKind]));
    await applyTotals(tx, out, o.slot);
    return out;
  });
  return rows.map(toEntry);
}

const LIVE_STATES = inArray(feeLedger.state, ["pending", "landed"]);
const NO_LIVE_SPLIT = sql`not exists (select 1 from fee_ledger s where s.kind = 'split_treasury'
  and s.ref = ${feeLedger.id} and s.state in ('pending','landed'))`;
const NO_LIVE_TWIN = sql`not exists (select 1 from fee_ledger s where s.mint = ${feeLedger.mint}
  and s.kind = ${feeLedger.kind} and s.window_index = ${feeLedger.windowIndex} and s.state in ('pending','landed'))`;

export function pgLedger(dbFn: () => Conn = db): LedgerStore {
  const rowsWhere = async (where: SQL | undefined, limit?: number) => {
    const q = dbFn().select().from(feeLedger).where(where).orderBy(asc(feeLedger.id)).$dynamic();
    return (await (limit ? q.limit(limit) : q)).map(toEntry);
  };
  return {
    // Close accounts and Run migrate send with no ledger row; drizzle throws on an empty values list.
    insertPending: async (news, sig, lvbh) => (news.length ? pgInsert(dbFn(), news, sig, lvbh) : []),
    settle: (sig, to, o = {}) => pgSettle(dbFn(), sig, to, o),
    pending: () => rowsWhere(eq(feeLedger.state, "pending")),
    pendingFor: (mint, kinds) =>
      rowsWhere(
        and(eq(feeLedger.mint, mint), inArray(feeLedger.kind, kinds), eq(feeLedger.state, "pending")),
      ),
    openCollects: (mint) => {
      const own = mint ? eq(feeLedger.mint, mint) : undefined;
      return rowsWhere(and(eq(feeLedger.kind, "collect"), eq(feeLedger.state, "landed"), own, NO_LIVE_SPLIT));
    },
    has: async (mint, kinds, windowIndex) => {
      const win = windowIndex === undefined ? undefined : eq(feeLedger.windowIndex, windowIndex);
      const where = and(eq(feeLedger.mint, mint), inArray(feeLedger.kind, kinds), LIVE_STATES, win);
      return (await rowsWhere(where, 1)).length > 0;
    },
    failedSweep: async (mint) => {
      const sweeps = inArray(feeLedger.kind, ["sweep_buyback", "sweep_treasury"]);
      const dead = inArray(feeLedger.state, ["failed", "expired"]);
      return (await rowsWhere(and(eq(feeLedger.mint, mint), sweeps, dead, NO_LIVE_TWIN), 1))[0] ?? null;
    },
    async hold(mint, reason) {
      await dbFn().transaction(async (tx) => {
        await tx.insert(feeLedger).values({ kind: "held", mint, detail: { reason } });
        await tx.update(coins).set({ finalize: "held" }).where(eq(coins.mint, mint));
      });
    },
    async release(mint) {
      const held = and(eq(coins.mint, mint), eq(coins.finalize, "held"));
      await dbFn().update(coins).set({ finalize: "none" }).where(held);
    },
    async markFinal(mint, deployerBps) {
      await dbFn().update(coins).set({ finalize: "done", deployerBps }).where(eq(coins.mint, mint));
    },
    async diff(mint, detail) {
      await dbFn().insert(feeLedger).values({ kind: "reconcile_diff", mint, detail });
    },
    implied: () => pgImplied(dbFn()),
  };
}
