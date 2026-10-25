// Simulate-first (D-04, D-12, RESEARCH Pattern 2): the engine's own jobs run against deps whose land simulates
// each built tx instead of sending it, so a preview never copies fee math, never signs for real and never writes
// a ledger row. Callers pass a copy of the coin: jobs mutate open, finalize and notReady even in dry mode.
// A single-tx RPC simulation cannot see an earlier unsent tx (Pitfall 2, A12), so only the first step is
// authoritative; later steps are estimates the RPC preflight checks again when they are sent (OQ1, A6).
import type { AdminBalanceRow, AdminSimResult, AdminTxAction } from "@bondr/core/api-admin";
import { COIN_DECIMALS } from "@bondr/core/launch";
import { budget } from "@bondr/core/send";
import { AccountLayout } from "@solana/spl-token";
import {
  type PublicKey,
  type SimulatedTransactionAccountInfo,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { LedgerStore } from "./fee-ledger.ts";
import { DEFAULT_CU, type FeeDeps, type Job } from "./fee-send.ts";

// Lamports for a "sol" watch, token units for a "token" watch; a missing or closed account reads 0.
export type AccountSnap = bigint;
export type Step = {
  ok: boolean;
  cu: number | null;
  err: string | null;
  feeLamports: bigint;
  pre: AccountSnap[];
  post: AccountSnap[];
  ixs: TransactionInstruction[];
};
export type Watched = {
  address: PublicKey;
  name: string;
  kind: "sol" | "token";
  unit: AdminBalanceRow["unit"];
}[];
type Watch = Watched[number];
type Snap = { lamports: number; data: Buffer } | null;

const SIG_FEE = 5_000n;
const MICRO_LAMPORTS = 1_000n; // budget()'s priority price
const DECIMALS: Record<AdminBalanceRow["unit"], number> = { SOL: 9, BONDR: 6, tokens: COIN_DECIMALS, bps: 0 };
// replaceRecentBlockhash swaps it for a live one, so a step costs no getLatestBlockhash call.
const ANY_BLOCKHASH = "11111111111111111111111111111111";
const READS = ["pending", "pendingFor", "openCollects", "has", "implied"] as const;

const snap = (w: Watch, a: Snap): AccountSnap =>
  !a ? 0n : w.kind === "sol" ? BigInt(a.lamports) : AccountLayout.decode(a.data).amount;
const fromSim = (a: SimulatedTransactionAccountInfo | null | undefined): Snap =>
  a ? { lamports: a.lamports, data: Buffer.from(a.data[0] ?? "", "base64") } : null;

// T-06-11-01: no job writes the ledger in dry mode; every method but the reads throws, so a future slip (or a
// new write method) is an error, never a stray row.
function readOnly(ledger: LedgerStore): LedgerStore {
  const refuse = (k: string) => () => {
    throw new Error(`simulation tried to write the fee ledger (${k})`);
  };
  const out = Object.fromEntries(Object.keys(ledger).map((k) => [k, refuse(k)])) as unknown as LedgerStore;
  for (const k of READS) Object.assign(out, { [k]: ledger[k] });
  return out;
}

export async function simulateJob(d: FeeDeps, job: Job, watch: Watched): Promise<Step> {
  const limit = job.cu ?? DEFAULT_CU;
  const instructions = [...budget(limit), ...job.ixs];
  const msg = new TransactionMessage({
    payerKey: d.ops.publicKey,
    recentBlockhash: ANY_BLOCKHASH,
    instructions,
  });
  const v0 = msg.compileToV0Message();
  const keys = watch.map((w) => w.address);
  const [infos, sim] = await Promise.all([
    keys.length ? d.conn.getMultipleAccountsInfo(keys) : [],
    d.conn.simulateTransaction(new VersionedTransaction(v0), {
      ...{ sigVerify: false, replaceRecentBlockhash: true },
      accounts: { encoding: "base64", addresses: keys.map((k) => k.toBase58()) },
    }),
  ]);
  const v = sim.value;
  const pre = watch.map((w, i) => snap(w, infos[i] ?? null));
  // A failed tx changes nothing, whatever accounts the RPC echoes back.
  const post = v.err || !v.accounts ? pre : watch.map((w, i) => snap(w, fromSim(v.accounts?.[i])));
  const priority = (BigInt(limit) * MICRO_LAMPORTS + 999_999n) / 1_000_000n;
  return {
    ...{ ok: !v.err, cu: v.unitsConsumed ?? null, err: v.err ? JSON.stringify(v.err) : null },
    feeLamports: SIG_FEE * BigInt(v0.header.numRequiredSignatures) + priority,
    ...{ pre, post, ixs: job.ixs },
  };
}

// D-12, D-16: the admin capture never sends, never publishes, and runs whatever the switches or holds say.
export function captureDeps(base: FeeDeps, sink: Step[], watch: Watched): FeeDeps {
  return {
    ...base,
    mode: "dry",
    ledger: readOnly(base.ledger),
    publish: () => {},
    allowed: () => true,
    land: async (job) => {
      sink.push(await simulateJob(base, job, watch));
      return { state: "dry" };
    },
  };
}

// Base units as a decimal string, trailing zeros dropped: 1500000 BONDR units -> "1.5".
function units(x: bigint, decimals: number): string {
  const s = (x < 0n ? -x : x).toString().padStart(decimals + 1, "0");
  const frac = s.slice(s.length - decimals).replace(/0+$/, "");
  return `${x < 0n ? "−" : ""}${s.slice(0, s.length - decimals)}${frac ? `.${frac}` : ""}`;
}
const signed = (x: bigint, decimals: number) => (x > 0n ? `+${units(x, decimals)}` : units(x, decimals));

// The net change per watched account: the sum of each step's simulated delta (estimated past the first step).
export function balanceRows(steps: Step[], watch: Watched): AdminBalanceRow[] {
  const first = steps[0];
  if (!first) return [];
  return watch.map((w, i) => {
    const before = first.pre[i] ?? 0n;
    const change = steps.reduce((sum, s) => sum + (s.post[i] ?? 0n) - (s.pre[i] ?? 0n), 0n);
    const dec = DECIMALS[w.unit];
    const shown = { before: units(before, dec), after: units(before + change, dec) };
    return { name: w.name, unit: w.unit, ...shown, change: signed(change, dec) };
  });
}

// Zero steps means the job had nothing to send ("Nothing to send"), never a success with no txs (Pitfall 7).
export function simSummary(
  action: AdminTxAction,
  mint: string | null,
  steps: Step[],
  dest: AdminSimResult["destinations"],
  watch: Watched,
): AdminSimResult {
  const first = steps[0];
  return {
    ...{ action, mint, ok: first?.ok === true },
    ...(first && !first.ok ? { error: first.err ?? "simulation failed" } : {}),
    steps: steps.map((s, i) => ({ ok: s.ok, cu: s.cu, estimated: i > 0 })),
    cu: steps.reduce((n, s) => n + (s.cu ?? 0), 0),
    feeLamports: String(steps.reduce((n, s) => n + s.feeLamports, 0n)),
    balances: balanceRows(steps, watch),
    destinations: dest,
    nothing: steps.length === 0,
  };
}
