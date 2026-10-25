// Fee ledger rows (D-08, D-23). Every engine tx is recorded pending, with its signature, before it is
// broadcast; the partial unique indexes then refuse a second sweep, split or bond burn. Landing a row moves the
// coin's fee columns in the same database transaction.
import type { LedgerKind, LedgerState } from "@bondr/core/api";
import { coins, type Db, db, feeLedger } from "@bondr/core/db";
import { type LandedRow, type TotalColumn, type Totals, totalsFor } from "@bondr/core/fees";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

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
  openCollects(): Promise<Entry[]>; // landed collects with no live split referencing them
  has(mint: string, kinds: LedgerKind[]): Promise<boolean>; // a live (pending or landed) row of the kinds
  hold(mint: string, reason: string): Promise<void>;
  diff(mint: string | null, detail: Record<string, unknown>): Promise<void>;
};

const live = (s: LedgerState | null) => s === "pending" || s === "landed";
const ONCE: LedgerKind[] = ["forced_bond", "pool_burn", "finalize_config", "finalize_update"];
const BURN: LedgerKind[] = ["forced_bond", "pool_burn"];
const SWEEP: LedgerKind[] = ["sweep_buyback", "sweep_treasury"];

// The fee_ledger unique indexes from migration 0005 as keys: once, bond_burn, sweep and split over live rows,
// sig_kind over every row with a signature.
function keysOf(e: Entry): string[] {
  const k = e.signature ? [`sig:${e.signature}:${e.kind}`] : [];
  if (!live(e.state)) return k;
  if (ONCE.includes(e.kind)) k.push(`once:${e.mint}:${e.kind}`);
  if (BURN.includes(e.kind)) k.push(`burn:${e.mint}`);
  if (SWEEP.includes(e.kind)) k.push(`sweep:${e.mint}:${e.kind}:${e.windowIndex}`);
  if (e.kind === "split_treasury") k.push(`split:${e.ref}`);
  return k;
}

const factsOf = (f: Partial<NewEntry> = {}): Partial<NewEntry> => {
  const { amount, burned, sol, detail } = f;
  return Object.fromEntries(
    Object.entries({ amount, burned, sol, detail }).filter(([, v]) => v !== undefined),
  );
};

const blank = { state: null, signature: null, lastValidBlockHeight: null, error: null, landedAt: null };

const pendingOf = (n: NewEntry, id: number, signature: string, lastValidBlockHeight: bigint): Entry => ({
  ...blank,
  ...n,
  ...{ id, state: "pending", signature, lastValidBlockHeight },
});

// True when any new row takes a key an existing row or an earlier new row already holds.
function refused(existing: Entry[], fresh: Entry[]): boolean {
  const taken = new Set(existing.flatMap(keysOf));
  for (const k of fresh.flatMap(keysOf)) {
    if (taken.has(k)) return true;
    taken.add(k);
  }
  return false;
}

// ponytail: mirrors the 0005 indexes so units and the fork stage run the engine's own code without Postgres;
// the database stays the real guard. Coin totals are not tracked here (the engine's publish applies them).
export function memoryLedger(): LedgerStore {
  const rows = new Map<number, Entry>();
  let next = 1;
  const all = () => [...rows.values()];
  const copy = (e: Entry): Entry => ({ ...e });
  const internal = async (kind: LedgerKind, mint: string | null, detail: Record<string, unknown>) => {
    const id = next++;
    rows.set(id, { ...blank, id, kind, mint, detail });
  };
  return {
    async insertPending(news, sig, lastValidBlockHeight) {
      const fresh = news.map((n, i) => pendingOf(n, next + i, sig, lastValidBlockHeight));
      if (refused(all(), fresh)) return null;
      next += fresh.length;
      for (const e of fresh) rows.set(e.id, e);
      return fresh.map(copy);
    },
    async settle(sig, to, o = {}) {
      const moved = all().filter((e) => e.signature === sig && e.state === "pending");
      for (const e of moved) {
        if (to === "landed") Object.assign(e, factsOf(o.facts?.[e.kind]), { landedAt: new Date() });
        Object.assign(e, { state: to, error: o.error ?? null });
      }
      return moved.map(copy);
    },
    pending: async () =>
      all()
        .filter((e) => e.state === "pending")
        .map(copy),
    openCollects: async () =>
      all()
        .filter((c) => c.kind === "collect" && c.state === "landed")
        .filter((c) => !all().some((s) => s.kind === "split_treasury" && s.ref === c.id && live(s.state)))
        .map(copy),
    has: async (mint, kinds) => all().some((e) => e.mint === mint && kinds.includes(e.kind) && live(e.state)),
    hold: (mint, reason) => internal("held", mint, { reason }),
    diff: (mint, detail) => internal("reconcile_diff", mint, detail),
  };
}

type Conn = Pick<Db, "select" | "insert" | "update" | "transaction">;
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

export function pgLedger(dbFn: () => Conn = db): LedgerStore {
  const rowsWhere = async (where: SQL | undefined, limit?: number) => {
    const q = dbFn().select().from(feeLedger).where(where).orderBy(asc(feeLedger.id)).$dynamic();
    return (await (limit ? q.limit(limit) : q)).map(toEntry);
  };
  return {
    insertPending: (news, sig, lvbh) => pgInsert(dbFn(), news, sig, lvbh),
    settle: (sig, to, o = {}) => pgSettle(dbFn(), sig, to, o),
    pending: () => rowsWhere(eq(feeLedger.state, "pending")),
    openCollects: () =>
      rowsWhere(and(eq(feeLedger.kind, "collect"), eq(feeLedger.state, "landed"), NO_LIVE_SPLIT)),
    has: async (mint, kinds) =>
      (await rowsWhere(and(eq(feeLedger.mint, mint), inArray(feeLedger.kind, kinds), LIVE_STATES), 1))
        .length > 0,
    async hold(mint, reason) {
      await dbFn().transaction(async (tx) => {
        await tx.insert(feeLedger).values({ kind: "held", mint, detail: { reason } });
        await tx.update(coins).set({ finalize: "held" }).where(eq(coins.mint, mint));
      });
    },
    async diff(mint, detail) {
      await dbFn().insert(feeLedger).values({ kind: "reconcile_diff", mint, detail });
    },
  };
}
