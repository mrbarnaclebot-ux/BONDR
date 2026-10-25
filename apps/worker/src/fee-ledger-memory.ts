// The in-memory LedgerStore for tests, dry runs and the fork. It mirrors the Postgres fee_ledger indexes so the
// engine's own code runs without a database.
import type { LedgerKind, LedgerState } from "@bondr/core/api";
import { type Entry, factsOf, type LedgerStore, type NewEntry } from "./fee-ledger.ts";
import { impliedOf } from "./fee-reconcile.ts";

const live = (s: LedgerState | null) => s === "pending" || s === "landed";
const ONCE: LedgerKind[] = ["forced_bond", "pool_burn", "finalize_config", "finalize_update"];
const BURN: LedgerKind[] = ["forced_bond", "pool_burn"];
const SWEEP: LedgerKind[] = ["sweep_buyback", "sweep_treasury"];

// The fee_ledger unique indexes from migration 0005 as keys: once, bond_burn, sweep and split over live rows,
// sig_kind over every row with a signature. sig_kind includes the mint since 0007, so one EVACUATE tx can carry a
// row per W; a null mint (buyback_burn) coalesces to '' like the index.
function keysOf(e: Entry): string[] {
  const k = e.signature ? [`sig:${e.signature}:${e.kind}:${e.mint ?? ""}`] : [];
  if (!live(e.state)) return k;
  if (ONCE.includes(e.kind)) k.push(`once:${e.mint}:${e.kind}`);
  if (BURN.includes(e.kind)) k.push(`burn:${e.mint}`);
  if (SWEEP.includes(e.kind)) k.push(`sweep:${e.mint}:${e.kind}:${e.windowIndex}`);
  if (e.kind === "split_treasury") k.push(`split:${e.ref}`);
  return k;
}

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

// ponytail: mirrors the 0005/0007 indexes so units and the fork stage run the engine's own code without Postgres;
// the database stays the real guard. Coin totals are not tracked here (the engine's publish applies them).
export function memoryLedger(): LedgerStore {
  const rows = new Map<number, Entry>();
  let next = 1;
  const all = () => [...rows.values()];
  const copy = (e: Entry): Entry => ({ ...e });
  const where = (f: (e: Entry) => boolean) => all().filter(f).map(copy);
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
    pending: async () => where((e) => e.state === "pending"),
    pendingFor: async (mint, kinds) =>
      where((e) => e.state === "pending" && e.mint === mint && kinds.includes(e.kind)),
    openCollects: async (mint) =>
      where((c) => c.kind === "collect" && c.state === "landed" && (!mint || c.mint === mint)).filter(
        (c) => !all().some((s) => s.kind === "split_treasury" && s.ref === c.id && live(s.state)),
      ),
    has: async (mint, kinds) => all().some((e) => e.mint === mint && kinds.includes(e.kind) && live(e.state)),
    hold: (mint, reason) => internal("held", mint, { reason }),
    release: async () => {},
    markFinal: async () => {},
    diff: (mint, detail) => internal("reconcile_diff", mint, detail),
    implied: async () => impliedOf(all()),
  };
}
