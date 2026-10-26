// The one send path of the fee engine (D-08, D-16, D-20): sign, record the intent, broadcast, settle. Every job
// goes through land, so crash safety, the ops floor and the program allowlist (signTx) live here only.
// Never resend an "unknown" tx: its row stays pending and boot recovery settles it from the signature.
import type { LedgerKind, Venue } from "@bondr/core/api";
import type { FeeJob } from "@bondr/core/api-admin";
import { heliusKey, redact } from "@bondr/core/net";
import { toSol } from "@bondr/core/price";
import type { OnlinePumpAmmSdk, OnlinePumpSdk } from "@bondr/core/pump";
import {
  type BlockhashInfo,
  broadcast,
  budget,
  fetchTx,
  pace,
  type RawOpts,
  type SendResult,
  settle,
  signTx,
} from "@bondr/core/send";
import { tokenDelta } from "@bondr/core/trade";
import {
  type ConfirmedTransactionMeta,
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { feeConfig, SENDER_TIPS, SENDER_URL } from "./fee-config.ts";
import type { Entry, Facts, LedgerStore, NewEntry } from "./fee-ledger.ts";
import type { TradeNet } from "./trade-quote.ts";

export type Job = {
  rows: NewEntry[];
  ixs: TransactionInstruction[];
  signers: Keypair[];
  urgent?: boolean; // runs below the ops floor (forced bond, fallback burn)
  sender?: boolean; // mainnet: tip plus Helius Sender; only the forced bond and the fallback burn set it
  cu?: number;
  facts?(meta: ConfirmedTransactionMeta): Facts;
};

export type Landed = {
  state: "landed" | "failed" | "unknown" | "skipped" | "dry" | "done";
  sig?: string;
  rows?: Entry[];
  meta?: ConfirmedTransactionMeta;
  code?: number; // the program's custom error code on a failed send (finalize reads 6009)
};

export type FeeDeps = {
  net: TradeNet;
  mode: "dry" | "on";
  conn: Connection;
  online: InstanceType<typeof OnlinePumpSdk>;
  amm: InstanceType<typeof OnlinePumpAmmSdk>;
  Q: PublicKey;
  ops: Keypair;
  treasury: PublicKey;
  treasuryExternal: boolean; // D-10: TREASURY_PUBKEY, a wallet the seed cannot derive (mainnet only)
  buyback: Keypair;
  ledger: LedgerStore;
  windowMs: number; // the closing sweep after finalize names the current window
  bondrSol(): number | null;
  publish(mint: string | null, rows: Entry[]): void;
  land(job: Job): Promise<Landed>;
  // Absent means allowed. The engine's deps set it in 06-07 (switches, hold); admin deps always allow (D-16).
  allowed?(job: FeeJob, coin: FeeCoin | null): boolean;
  sim?: true; // WR-W-05: an admin preview, which must not stamp the health panel's last-run marks
};

// launchSig and wallet feed the 05-08 deployer pre-flight.
export type FeeCoin = {
  mint: PublicKey;
  w: Keypair;
  launchedAt: number;
  venue: Venue;
  feesUnclaimed: bigint;
  feeBudget: bigint;
  cost: bigint | null;
  launchSig: string;
  wallet: PublicKey;
  finalize: "none" | "held" | "done";
  // Set before any collect or bond burn is sent and at boot: only then does the spend guard read Postgres, so
  // an idle coin's window costs no database wake-up (D-03).
  open?: boolean;
  notReady?: { budget: bigint; cost: bigint }; // memory at the last chain "not ready" forced bond verdict
  hold?: string; // the manual hold reason (coins.held_reason), separate from finalize "held" (Pitfall 13)
};

const SENDER_TIMEOUT_MS = 10_000;
export const DEFAULT_CU = 400_000;

// ponytail: per-process flag while the worker runs one replica (D-07). Set from each landed meta and the
// boot balance read, so the floor costs no extra RPC call while ops is above it.
let low = false;
let checkedAt = 0;
const OPS_RECHECK_MS = 60_000;
export const opsLow = (): boolean => low;
export function noteOps(lamports: number, net: TradeNet): void {
  const was = low;
  low = lamports < feeConfig(net).opsFloorLamports;
  if (low && !was)
    console.error(`ops below floor: ${lamports / LAMPORTS_PER_SOL} SOL, non-urgent fee sends paused`);
}

// WR-04: while paused, ops is re-read on the RPC at most once a minute (no database), so a manual top-up resumes
// non-urgent sends without waiting for an urgent tx to land or a redeploy. A failed read stays paused.
export async function refreshOps(d: Pick<FeeDeps, "conn" | "ops" | "net">): Promise<boolean> {
  if (!low || Date.now() - checkedAt < OPS_RECHECK_MS) return low;
  checkedAt = Date.now();
  try {
    noteOps(await d.conn.getBalance(d.ops.publicKey), d.net);
  } catch {}
  return low;
}

export const tipIxs = (net: TradeNet, ops: PublicKey, lamports: number, pick = Math.random) =>
  net === "mainnet"
    ? [
        SystemProgram.transfer({
          fromPubkey: ops,
          toPubkey: new PublicKey(SENDER_TIPS[Math.floor(pick() * SENDER_TIPS.length)] as string),
          lamports,
        }),
      ]
    : [];

const unknown = (o: RawOpts, err: string): SendResult => ({
  ...{ ok: false, status: "unknown", sig: o.sig, lastValidBlockHeight: o.lastValidBlockHeight },
  ...{ bytes: o.bytes, err: redact(err) },
});

// Keyed Sender gets 50 req/s instead of a keyless 1/s per IP (Pitfall 11). swqos_only lets a tip under 0.001 SOL
// route at all (Pitfall 10); forced bonds pay 0.001 and never set it. Built per call and never logged.
const senderUrl = (swqosOnly?: boolean) =>
  `${SENDER_URL}?api-key=${heliusKey()}${swqosOnly ? "&swqos_only=true" : ""}`;

// Sender skips preflight, so a failure here may still land: always "unknown", settled from the signature.
export async function urgentBroadcast(
  net: TradeNet,
  conn: Connection,
  raw: Uint8Array,
  o: RawOpts & { swqosOnly?: boolean },
  post: typeof fetch = fetch,
): Promise<SendResult | null> {
  if (net !== "mainnet") return broadcast(conn, raw, o);
  await pace(o.paceMs ?? 0);
  const params = [
    Buffer.from(raw).toString("base64"),
    { encoding: "base64", skipPreflight: true, maxRetries: 0 },
  ];
  try {
    const res = await post(senderUrl(o.swqosOnly), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "sendTransaction", params }),
      signal: AbortSignal.timeout(SENDER_TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    return res.ok && !j.error ? null : unknown(o, `sender ${res.status} ${j.error?.message ?? ""}`);
  } catch (e) {
    return unknown(o, `sender ${e instanceof Error ? e.message : String(e)}`);
  }
}

const what = (job: Job) => job.rows.map((r) => `${r.kind} ${r.mint?.slice(0, 8) ?? "platform"}`).join(", ");

// Each row's SOL value at landing, from the BONDR price in memory (D-04); unknown price leaves sol unset. A row
// built with its own sol keeps it: facts apply per kind, so one row's value would overwrite its siblings'.
export function withSol(job: Pick<Job, "rows">, facts: Facts, bondrSol: number | null): Facts {
  const out: Facts = { ...facts };
  for (const r of job.rows) {
    if (r.sol !== undefined) continue;
    const f = { ...out[r.kind] };
    const amount = f.amount ?? r.amount;
    if (f.sol === undefined && amount !== undefined && bondrSol !== null) f.sol = toSol(amount, bondrSol);
    out[r.kind] = f;
  }
  return out;
}

type Delta = (owner: PublicKey) => bigint;
const W_IN: LedgerKind[] = ["collect", "finalize_config", "finalize_update"];
const W_OUT: LedgerKind[] = ["forced_bond", "pool_burn"];
function distributed(detail: NewEntry["detail"], delta: Delta): Partial<NewEntry> | undefined {
  const [dk, tk] = [detail?.deployer, detail?.treasury];
  if (typeof dk !== "string" || typeof tk !== "string") return undefined;
  const [dx, tx] = [delta(new PublicKey(dk)), delta(new PublicKey(tk))];
  return { amount: dx + tx, detail: { ...detail, deployerAmount: String(dx), treasuryAmount: String(tx) } };
}

// Each row's landed amount from its tx's own meta (D-14): what W gained (collect, finalize) or spent (bond
// burns), and for a distribute what the two holders the row names gained. Jobs and boot recovery share it, so a
// recovered row lands with the same facts (WR-03). Other kinds keep their intent amount.
export function factsFor(
  rows: NewEntry[],
  meta: ConfirmedTransactionMeta,
  Q: PublicKey,
  w?: PublicKey,
): Facts {
  const delta: Delta = (owner) => tokenDelta(meta, Q, owner);
  const out: Facts = {};
  for (const { kind, detail } of rows) {
    if (kind === "distribute") out.distribute = distributed(detail, delta);
    if (w && W_IN.includes(kind)) out[kind] = { amount: delta(w) };
    if (w && W_OUT.includes(kind)) out[kind] = { amount: -delta(w) };
  }
  return out;
}

async function dry(d: FeeDeps, job: Job, raw: Uint8Array): Promise<Landed> {
  const tx = VersionedTransaction.deserialize(raw);
  const sim = await d.conn.simulateTransaction(tx, { sigVerify: false });
  const v = sim.value;
  console.log(`fee dry ${what(job)}: ${v.err ? `err ${JSON.stringify(v.err)}` : `ok ${v.unitsConsumed} CU`}`);
  return { state: "dry" };
}

// A confirmed signature has landed; only its meta lags on a load-balanced RPC. fetchTx polls 10 s per try.
const META_TRIES = 3;
export async function metaOf(conn: Connection, sig: string): Promise<Awaited<ReturnType<typeof fetchTx>>> {
  for (let i = 0; i < META_TRIES; i++) {
    const tx = await fetchTx(conn, sig);
    if (tx) return tx;
  }
  return undefined;
}

// One tx can carry rows for several coins (EVACUATE, the leftover sweep); each coin hears only its own.
export function publishByMint(d: Pick<FeeDeps, "publish">, rows: Entry[]): void {
  for (const [mint, list] of Map.groupBy(rows, (r) => r.mint)) d.publish(mint, list);
}

async function landed(d: FeeDeps, job: Job, sig: string): Promise<Landed> {
  const tx = await metaOf(d.conn, sig);
  if (!tx) {
    console.error(`fee ${what(job)} landed without meta, left pending: ${sig}`);
    return { state: "unknown", sig };
  }
  const facts = withSol(job, job.facts?.(tx.meta) ?? {}, d.bondrSol());
  const rows = await d.ledger.settle(sig, "landed", { facts, slot: BigInt(tx.slot) });
  noteOps(tx.meta.postBalances[0] ?? 0, d.net);
  publishByMint(d, rows);
  return { state: "landed", sig, rows, meta: tx.meta };
}

async function conclude(d: FeeDeps, job: Job, r: SendResult, sig: string): Promise<Landed> {
  if (r.status === "landed") return landed(d, job, sig);
  const err = redact(`${r.code === undefined ? "" : `code ${r.code}: `}${r.err ?? r.status}`);
  console.error(`fee ${what(job)} ${r.status}: ${err}`);
  if (r.status === "unknown") return { state: "unknown", sig };
  return { state: "failed", sig, code: r.code, rows: await d.ledger.settle(sig, "failed", { error: err }) };
}

export async function land(d: FeeDeps, job: Job): Promise<Landed> {
  if (!job.urgent && (await refreshOps(d))) return { state: "skipped" };
  const cfg = feeConfig(d.net);
  const bh: BlockhashInfo = await d.conn.getLatestBlockhash();
  const tip = job.sender ? tipIxs(d.net, d.ops.publicKey, cfg.senderTipLamports) : [];
  const ixs = [...budget(job.cu ?? DEFAULT_CU), ...tip, ...job.ixs];
  const s = signTx({ conn: d.conn, payer: d.ops, signers: job.signers, ixs, bh });
  if (!s.ok) {
    console.error(`fee ${what(job)} refused: ${s.err}`);
    return { state: "failed" };
  }
  if (d.mode === "dry") return dry(d, job, s.raw);
  const rows = await d.ledger.insertPending(job.rows, s.sig, BigInt(bh.lastValidBlockHeight));
  if (!rows) return { state: "done" };
  const o: RawOpts = { ...bh, sig: s.sig, bytes: s.bytes, paceMs: cfg.paceMs };
  const sent = job.sender
    ? await urgentBroadcast(d.net, d.conn, s.raw, o)
    : await broadcast(d.conn, s.raw, o);
  return conclude(d, job, sent ?? (await settle(d.conn, s.sig, s.bytes, false, bh)), s.sig);
}
