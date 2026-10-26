// Boot recovery of fee rows (D-08, Pitfall 2). Runs once before the engine takes any job: every pending row is
// settled from its signature's chain status, then every landed collect with no live split gets its split.
// Never resend an "unknown" tx: an unseen row past its blockhash is rechecked with history and only then
// expired, and an RPC error leaves it pending for the next check. Nothing here signs or broadcasts; the split
// goes through d.land like every other job.
import { setTimeout as delay } from "node:timers/promises";
import { redact } from "@bondr/core/net";
import type { Entry } from "./fee-ledger.ts";
import { splitJob } from "./fee-prebond.ts";
import { type FeeCoin, type FeeDeps, factsFor, metaOf, publishByMint, withSol } from "./fee-send.ts";
import { HEIGHT_EVERY, nextState, type Obs, POLL_MS, RECHECK_MS, type Seen } from "./settle.ts";

export type Action =
  | { to: "landed" | "poll" | "recheck" | "pending" }
  | { to: "failed" | "expired"; error: string };
type CoinOf = (mint: string) => FeeCoin | undefined;
type Sleep = (ms: number) => Promise<unknown>;
type Count = Record<"landed" | "failed" | "expired", number>;

const CHUNK = 256; // getSignatureStatuses takes at most 256 signatures

const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

// settle.ts decides; an RPC error is never a verdict, so the row waits for the next check.
export function recoverAction(o: Obs): Action {
  if (o.rpcError) return { to: "pending" };
  const n = nextState(o);
  if (n.to === "unknown") return { to: "pending" };
  if (n.to === "failed" && n.error === "expired") return { to: "expired", error: n.error };
  return n;
}

async function statuses(d: FeeDeps, sigs: string[]): Promise<Map<string, Seen> | null> {
  const out = new Map<string, Seen>();
  try {
    for (let i = 0; i < sigs.length; i += CHUNK) {
      const part = sigs.slice(i, i + CHUNK);
      const { value } = await d.conn.getSignatureStatuses(part, { searchTransactionHistory: true });
      part.forEach((s, j) => {
        const st = value[j];
        const done = st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
        out.set(s, st ? { confirmed: done, err: st.err } : null);
      });
    }
    return out;
  } catch (e) {
    logged("fee recover status")(e);
    return null;
  }
}

// Facts from the tx's own meta, as the job that sent it would have (D-14); the slot guards fees_unclaimed
// (Pitfall 3). A multi-mint tx reads each mint's rows against that coin's W (Pitfall 5).
// ponytail: Facts are keyed by kind, so two mints with the same W-delta kind in one tx would share one value;
// no job builds that today (EVACUATE rows carry their own amounts). Key facts by row if one ever does.
async function landed(d: FeeDeps, sig: string, rows: Entry[], coinOf: CoinOf): Promise<boolean> {
  const tx = await metaOf(d.conn, sig);
  if (!tx) {
    console.error(`fee recover ${sig}: landed without meta, left pending`);
    return false;
  }
  const facts = Object.assign(
    {},
    ...[...Map.groupBy(rows, (r) => r.mint)].map(([mint, list]) =>
      factsFor(list, tx.meta, d.Q, mint ? coinOf(mint)?.w.publicKey : undefined),
    ),
  );
  const o = { facts: withSol({ rows }, facts, d.bondrSol()), slot: BigInt(tx.slot) };
  publishByMint(d, await d.ledger.settle(sig, "landed", o));
  return true;
}

// False: the rows are still pending (landed, but no meta yet).
async function conclude(d: FeeDeps, sig: string, rows: Entry[], a: Action, coinOf: CoinOf, n: Count) {
  if (a.to === "landed") {
    if (!(await landed(d, sig, rows, coinOf))) return false;
    n.landed++;
  } else if (a.to === "failed" || a.to === "expired") {
    await d.ledger.settle(sig, a.to, { error: a.error });
    n[a.to]++;
  }
  return true;
}

// One status call per round for every open signature: poll while any is inside its blockhash, else wait out
// a recheck. Returns how many signatures are still pending.
async function settleAll(d: FeeDeps, groups: Map<string, Entry[]>, coinOf: CoinOf, sleep: Sleep, n: Count) {
  const todo = new Map(groups);
  let stuck = 0;
  const rechecks = new Map<string, number>();
  let height = 0;
  for (let i = 0; todo.size; i++) {
    const seen = await statuses(d, [...todo.keys()]);
    if (i % HEIGHT_EVERY === 0) height = await d.conn.getBlockHeight().catch(() => -1);
    if (!seen || height < 0) break;
    let polling = false;
    for (const [sig, rows] of todo) {
      const lastValid = Number(rows[0]?.lastValidBlockHeight ?? 0);
      const a = recoverAction({
        seen: seen.get(sig) ?? null,
        height,
        lastValid,
        rechecks: rechecks.get(sig) ?? 0,
      });
      if (a.to === "poll") polling = true;
      if (a.to === "poll" || a.to === "recheck" || a.to === "pending") continue;
      todo.delete(sig);
      if (!(await conclude(d, sig, rows, a, coinOf, n))) stuck++;
    }
    if (!todo.size) break;
    if (!polling) for (const s of todo.keys()) rechecks.set(s, (rechecks.get(s) ?? 0) + 1);
    await sleep(polling ? POLL_MS : RECHECK_MS);
  }
  return todo.size + stuck;
}

const bySig = (rows: Entry[]) => Map.groupBy(rows, (e) => e.signature ?? "");

// The same settle at runtime for some pending rows (spendGuard runs it per coin, CR-01). Returns how many
// signatures are still pending.
export const settleRows = (d: FeeDeps, rows: Entry[], coinOf: CoinOf, sleep: Sleep = delay) =>
  settleAll(d, bySig(rows), coinOf, sleep, { landed: 0, failed: 0, expired: 0 });

// A failed split never fails the boot: the collect stays open and the coin's next window splits it.
// A coin with a pending row or an open collect at boot: its first spend guard reads the ledger (FeeCoin.open).
function markOpen(coinOf: CoinOf, mint: string | null): FeeCoin | undefined {
  const coin = mint ? coinOf(mint) : undefined;
  if (coin) coin.open = true;
  return coin;
}

async function splitOpen(d: FeeDeps, coinOf: CoinOf): Promise<void> {
  for (const c of await d.ledger.openCollects()) {
    const coin = markOpen(coinOf, c.mint);
    if (coin) await splitJob(d, coin, c).catch(logged(`fee recover split ${c.id}`));
  }
}

// WR-01: the daily batch settles every pending row past its blockhash, as at boot, so a dropped forced bond or
// finalize never holds its once-only key until a restart. A row inside its blockhash belongs to a send still in
// flight and is left to it. Returns how many signatures are still pending.
export async function settleStale(d: FeeDeps, coinOf: CoinOf, sleep: Sleep = delay): Promise<number> {
  const pending = d.mode === "on" ? await d.ledger.pending() : [];
  if (!pending.length) return 0;
  const height = await d.conn.getBlockHeight();
  const stale = pending.filter((e) => Number(e.lastValidBlockHeight ?? 0) < height);
  for (const e of stale) markOpen(coinOf, e.mint);
  return stale.length ? settleRows(d, stale, coinOf, sleep) : 0;
}

export async function recover(d: FeeDeps, coinOf: CoinOf, sleep: Sleep = delay): Promise<void> {
  const pending = await d.ledger.pending();
  for (const e of pending) markOpen(coinOf, e.mint);
  const groups = bySig(pending);
  const n: Count = { landed: 0, failed: 0, expired: 0 };
  if (d.mode === "dry") console.log(`fee recover: ${groups.size} pending, left as is in dry mode`);
  else if (groups.size) {
    const left = await settleAll(d, groups, coinOf, sleep, n);
    console.log(
      `fee recover: ${groups.size} pending, ${n.landed} landed, ${n.failed} failed, ${n.expired} expired`,
    );
    if (left) console.error(`fee recover: ${left} signatures left pending`);
  }
  await splitOpen(d, coinOf);
}
