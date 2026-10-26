// EVACUATE (ADMIN-11, D-35, D-36), the break-glass drain for a leaked master seed: every W's BONDR and SOL go to
// the treasury and its child tokens are burned, never moved (child supply in the treasury would be a dev-like
// holder). Several W sign each tx, packed greedily under the packet limit. Batches touch disjoint W, so each
// batch's simulation is authoritative on its own, unlike the dependent steps of a coin action (OQ1).
import type { AdminSimResult, EvacuateTotals } from "@bondr/core/api-admin";
import { COIN_DECIMALS } from "@bondr/core/launch";
import { toSol } from "@bondr/core/price";
import { budget, PACKET_LIMIT, pace, wireSize } from "@bondr/core/send";
import { ataIx } from "@bondr/core/trade";
import {
  AccountLayout,
  createBurnCheckedInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import {
  type AccountInfo,
  type Keypair,
  type PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { type Allowed, allowFor, passedLines, refusedDestination } from "./admin-dest.ts";
import { type Intent, putIntent, updateIntent } from "./admin-intent.ts";
import type { MoneyCtx } from "./admin-money.ts";
import { codeOf, gatedDeps, logged, outcome, progress } from "./admin-send.ts";
import { type Step, simulateJob } from "./admin-sim.ts";
import { loadFeeCoins } from "./fee-boot.ts";
import { feeConfig } from "./fee-config.ts";
import type { NewEntry } from "./fee-ledger.ts";
import { DEFAULT_CU, type FeeCoin, type FeeDeps, type Job, type Landed } from "./fee-send.ts";
import { fail } from "./http.ts";
import { pauseAll } from "./switches.ts";

export type EvacCoin = Pick<FeeCoin, "mint" | "w">;
export type WBalance = {
  mint: PublicKey;
  w: Keypair;
  lamports: bigint;
  bondr: bigint;
  child: bigint;
  childProgram: PublicKey;
};
type PerW = { b: WBalance; ixs: TransactionInstruction[] };
type Planned = { batch: WBalance[]; job: Job };

const BONDR_DECIMALS = 6; // the quote mint (price.ts)
const READ_CHUNK = 100; // getMultipleAccountsInfo's limit
// ponytail: 8 simulations in flight keeps hundreds of W inside the forwarder's 90 s evacuate timeout (06-12)
// without tripping RPC rate limits. Raise it, or page the run, if W counts grow past a few thousand.
export const EVAC_SIM_CONCURRENCY = 8;

const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);
const units = (a: AccountInfo<Buffer> | null | undefined) => (a ? AccountLayout.decode(a.data).amount : 0n);
const sum = (xs: bigint[]) => xs.reduce((n, x) => n + x, 0n);
export const coinsOf = (ctx: MoneyCtx): Promise<EvacCoin[]> => (ctx.coins ?? loadFeeCoins)();

// W and its BONDR and child accounts, 100 accounts per read; a W with nothing anywhere is left out.
export async function evacuateBalances(
  d: Pick<FeeDeps, "conn" | "Q">,
  coins: EvacCoin[],
): Promise<WBalance[]> {
  const keys = coins.flatMap((c) => [c.w.publicKey, ataOf(d.Q, c.w.publicKey), ataOf(c.mint, c.w.publicKey)]);
  const infos: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += READ_CHUNK)
    infos.push(...(await d.conn.getMultipleAccountsInfo(keys.slice(i, i + READ_CHUNK))));
  return coins.flatMap((c, i) => {
    const [w, q, child] = infos.slice(i * 3, i * 3 + 3);
    const b = { ...c, lamports: BigInt(w?.lamports ?? 0), bondr: units(q), child: units(child) };
    return b.lamports || b.bondr || b.child ? [{ ...b, childProgram: T22 }] : [];
  });
}

// D-36: the only outflows are the treasury (BONDR and SOL) and burn; no W, no child mint, no other owner.
export const evacuateAllow = (d: Pick<FeeDeps, "Q" | "treasury">): Allowed =>
  allowFor({ treasury: d.treasury, internal: [], mints: [d.Q], closeTo: d.treasury });

// Ops pays for the treasury's BONDR account once per batch if it is missing (idempotent create).
const head = (d: Pick<FeeDeps, "Q" | "ops" | "treasury">) => [ataIx(d.ops.publicKey, d.Q, d.treasury)];

function wIxs(d: Pick<FeeDeps, "Q" | "treasury">, b: WBalance): TransactionInstruction[] {
  const w = b.w.publicKey;
  const ixs: TransactionInstruction[] = [];
  const to = ataOf(d.Q, d.treasury);
  if (b.bondr)
    ixs.push(createTransferCheckedInstruction(ataOf(d.Q, w), d.Q, to, w, b.bondr, BONDR_DECIMALS, [], T22));
  if (b.child) {
    const acct = getAssociatedTokenAddressSync(b.mint, w, true, b.childProgram);
    ixs.push(createBurnCheckedInstruction(acct, b.mint, w, b.child, COIN_DECIMALS, [], b.childProgram));
  }
  if (b.lamports)
    ixs.push(SystemProgram.transfer({ fromPubkey: w, toPubkey: d.treasury, lamports: b.lamports }));
  return ixs;
}

// RESEARCH Code Example 5: add W while the whole tx (budget, head, every W's ixs) fits; a W that alone
// overflows still gets its own batch, and signTx then refuses it as too large rather than dropping it.
export function packBatches(
  ops: PublicKey,
  perW: PerW[],
  first: TransactionInstruction[] = [],
): WBalance[][] {
  const batches: WBalance[][] = [];
  let cur: PerW[] = [];
  for (const one of perW) {
    const next = [...cur, one];
    const size = wireSize(ops, [...budget(DEFAULT_CU), ...first, ...next.flatMap((x) => x.ixs)]);
    if (size > PACKET_LIMIT && cur.length) {
      batches.push(cur.map((x) => x.b));
      cur = [one];
    } else cur = next;
  }
  if (cur.length) batches.push(cur.map((x) => x.b));
  return batches;
}

// Pitfall 4: each row carries its own amount and sol and the job passes no facts, so no row takes a sibling's
// value. An unknown price writes sol 0, never unset, or withSol would fill every row from the first one.
export function buildBatch(d: Pick<FeeDeps, "Q" | "ops" | "treasury" | "bondrSol">, batch: WBalance[]): Job {
  const price = d.bondrSol();
  const rows: NewEntry[] = batch.flatMap((b) => {
    const mint = b.mint.toBase58();
    const move = {
      kind: "evacuate" as const,
      mint,
      amount: b.bondr,
      sol: price === null ? 0n : toSol(b.bondr, price),
    };
    return b.child ? [move, { kind: "leftover_burn" as const, mint, burned: b.child }] : [move];
  });
  const ixs = [...head(d), ...batch.flatMap((b) => wIxs(d, b))];
  // CR-W-01: break-glass, so the ops floor never skips it; a leaked seed drains ops first.
  return { rows, ixs, signers: batch.map((b) => b.w), urgent: true };
}

export function planBatches(d: FeeDeps, balances: WBalance[]): Planned[] {
  const perW = balances.map((b) => ({ b, ixs: wIxs(d, b) }));
  return packBatches(d.ops.publicKey, perW, head(d)).map((batch) => ({ batch, job: buildBatch(d, batch) }));
}

// A small promise pool: at most EVAC_SIM_CONCURRENCY calls in flight, results in input order.
async function pool<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const lane = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i] as T);
  };
  await Promise.all(Array.from({ length: EVAC_SIM_CONCURRENCY }, lane));
  return out;
}

// An RPC error fails only its own batch; its text never leaves the worker (codeOf).
const simulated = (d: FeeDeps, job: Job): Promise<Step> =>
  simulateJob(d, job, []).catch(() => ({
    ...{ ok: false, cu: null, err: "rpc", feeLamports: 0n, pre: [], post: [], ixs: job.ixs },
  }));

function totalsOf(d: FeeDeps, plan: Planned[], steps: Step[]): EvacuateTotals {
  const all = plan.flatMap((p) => p.batch);
  const bondr = sum(all.map((b) => b.bondr));
  const price = d.bondrSol();
  return {
    ...{
      wallets: all.length,
      bondr: String(bondr),
      bondrSol: price === null ? "0" : String(toSol(bondr, price)),
    },
    ...{ sol: String(sum(all.map((b) => b.lamports))), burnedIn: all.filter((b) => b.child).length },
    failures: plan.reduce((n, p, i) => n + (steps[i]?.ok ? 0 : p.batch.length), 0),
  };
}

function summaryOf(d: FeeDeps, plan: Planned[], steps: Step[], allowed: Allowed): AdminSimResult {
  const refused = plan.map((p) => refusedDestination(p.job.ixs, allowed)).find((r) => r !== null);
  const bad = steps.find((s) => !s.ok);
  return {
    ...{ action: "evacuate", mint: null, ok: steps.some((s) => s.ok) },
    ...(bad && { error: codeOf(bad.err ?? "") }),
    steps: steps.map((s) => ({ ok: s.ok, cu: s.cu, estimated: false })),
    cu: steps.reduce((n, s) => n + (s.cu ?? 0), 0),
    feeLamports: String(sum(steps.map((s) => s.feeLamports))),
    balances: [],
    destinations: refused ? { ok: false, refused } : { ok: true, passed: passedLines(allowed) },
    nothing: plan.length === 0,
    totals: totalsOf(d, plan, steps),
  };
}

// D-35 step 2. A2 (Claude's discretion, owner may override): an intent only when ADMIN_EVACUATE is on and the
// net is devnet, so staging and the default config can preview but never execute.
export async function simulateEvacuate(ctx: MoneyCtx): Promise<AdminSimResult> {
  const d = ctx.deps;
  const plan = planBatches(d, await evacuateBalances(d, await coinsOf(ctx)));
  const allowed = evacuateAllow(d);
  const sum = summaryOf(d, plan, await pool(plan, (p) => simulated(d, p.job)), allowed);
  if (!sum.ok || !sum.destinations.ok || ctx.evacuate !== "on" || d.net !== "devnet") return sum;
  const to = [`Treasury ${d.treasury.toBase58()}`];
  const e = putIntent(
    { action: "evacuate", mint: null, to, data: { allowed, summary: sum } },
    (ctx.now ?? Date.now)(),
  );
  return { ...sum, intent: { id: e.id, message: e.message, expiresAt: e.expiresAt } };
}

// A2, D-37: execution needs ADMIN_EVACUATE=on and devnet. Boot already refuses "on" off devnet; this re-check
// keeps mainnet, or any other net, refused in the loop itself, before anything is paused or sent.
export function evacuateRefusal(ctx: MoneyCtx): void {
  if (ctx.evacuate !== "on") throw fail({ error: "not_applicable", reason: "simulate_only" });
  if (ctx.deps.net !== "devnet") throw fail({ error: "not_applicable", reason: "devnet_only" });
}

type Run = { id: string; seen: Landed[]; moved: number; failed: number; refused: string | null };
const counts = (r: Run) => ({ ...progress(r.seen), moved: r.moved, failed: r.failed });

// T-06-22-02: the batch's coins' queued jobs settle first, then balances are read again, so no engine job races
// a W move. A W emptied since the plan drops out; a grown one re-packs.
async function moveBatch(ctx: MoneyCtx, d: FeeDeps, batch: WBalance[], r: Run): Promise<void> {
  await ctx.engine?.idle(batch.map((b) => b.mint.toBase58()));
  for (const p of planBatches(d, await evacuateBalances(d, batch))) {
    const l = await d.land(p.job);
    r.seen.push(l);
    if (l.state === "landed") r.moved += p.batch.length;
    else r.failed += p.batch.length;
    updateIntent(r.id, counts(r), (ctx.now ?? Date.now)());
  }
}

// D-35 step 4: every switch off and evacuated_at first, then the batches one by one through the gated land (the
// allowlist the owner signed, D-14), paced like the engine. A failed batch leaves later W to go; an unknown one
// is never resent. The audit row settles once at the end with every signature (D-33).
export async function executeEvacuate(ctx: MoneyCtx, e: Intent, auditId: string): Promise<void> {
  evacuateRefusal(ctx);
  const r: Run = { id: e.id, seen: [], moved: 0, failed: 0, refused: null };
  const d = gatedDeps(ctx.deps, (e.data as { allowed: Allowed }).allowed, (to) => {
    r.refused ??= to;
  });
  let threw = false;
  try {
    await pauseAll();
    const plan = planBatches(d, await evacuateBalances(d, await coinsOf(ctx)));
    for (const [i, p] of plan.entries()) {
      if (i) await pace(feeConfig(d.net).paceMs);
      await moveBatch(ctx, d, p.batch, r);
      if (r.refused) break;
    }
  } catch (err) {
    threw = true;
    logged("evacuate")(err);
  }
  const out = outcome(r.seen, r.refused, threw);
  const view = { ...counts(r), state: out.state, ...(out.error && { code: out.error }) };
  updateIntent(e.id, view, (ctx.now ?? Date.now)());
  await ctx.audit.settle(auditId, out.result, { sigs: view.sigs, ...(out.error && { error: out.error }) });
}
