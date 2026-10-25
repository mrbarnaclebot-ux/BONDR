// The one send path of the fee engine (D-08, D-16, D-20): sign, record the intent, broadcast, settle. Every job
// goes through land, so crash safety, the ops floor and the program allowlist (signTx) live here only.
// Never resend an "unknown" tx: its row stays pending and boot recovery settles it from the signature.
import type { Venue } from "@bondr/core/api";
import { redact } from "@bondr/core/net";
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
import { feeConfig, OPS_FLOOR_LAMPORTS, SENDER_TIPS, SENDER_URL } from "./fee-config.ts";
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
  buyback: Keypair;
  ledger: LedgerStore;
  bondrSol(): number | null;
  publish(mint: string | null, rows: Entry[]): void;
  land(job: Job): Promise<Landed>;
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
};

const SENDER_TIMEOUT_MS = 10_000;
const DEFAULT_CU = 400_000;

// ponytail: per-process flag while the worker runs one replica (D-07). Set from each landed meta and the
// boot balance read, so the floor never costs an extra RPC call.
let low = false;
export const opsLow = (): boolean => low;
export function noteOps(lamports: number): void {
  low = lamports < OPS_FLOOR_LAMPORTS;
  if (low) console.error(`ops below floor: ${lamports / LAMPORTS_PER_SOL} SOL, non-urgent fee sends paused`);
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

// Sender skips preflight, so a failure here may still land: always "unknown", settled from the signature.
export async function urgentBroadcast(
  net: TradeNet,
  conn: Connection,
  raw: Uint8Array,
  o: RawOpts,
  post: typeof fetch = fetch,
): Promise<SendResult | null> {
  if (net !== "mainnet") return broadcast(conn, raw, o);
  await pace(o.paceMs ?? 0);
  const params = [
    Buffer.from(raw).toString("base64"),
    { encoding: "base64", skipPreflight: true, maxRetries: 0 },
  ];
  try {
    const res = await post(SENDER_URL, {
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

// Each row's SOL value at landing, from the BONDR price in memory (D-04); unknown price leaves sol unset.
export function withSol(job: Pick<Job, "rows">, facts: Facts, bondrSol: number | null): Facts {
  const out: Facts = { ...facts };
  for (const r of job.rows) {
    const f = { ...out[r.kind] };
    const amount = f.amount ?? r.amount;
    if (f.sol === undefined && amount !== undefined && bondrSol !== null) f.sol = toSol(amount, bondrSol);
    out[r.kind] = f;
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

async function landed(d: FeeDeps, job: Job, sig: string): Promise<Landed> {
  const tx = await fetchTx(d.conn, sig);
  if (!tx) {
    console.error(`fee ${what(job)} landed without meta, left pending: ${sig}`);
    return { state: "unknown", sig };
  }
  const facts = withSol(job, job.facts?.(tx.meta) ?? {}, d.bondrSol());
  const rows = await d.ledger.settle(sig, "landed", { facts, slot: BigInt(tx.slot) });
  noteOps(tx.meta.postBalances[0] ?? 0);
  if (rows.length) d.publish(rows[0]?.mint ?? null, rows);
  return { state: "landed", sig, rows, meta: tx.meta };
}

async function conclude(d: FeeDeps, job: Job, r: SendResult, sig: string): Promise<Landed> {
  if (r.status === "landed") return landed(d, job, sig);
  const err = redact(r.err ?? r.status);
  console.error(`fee ${what(job)} ${r.status}: ${err}`);
  if (r.status === "unknown") return { state: "unknown", sig };
  return { state: "failed", sig, rows: await d.ledger.settle(sig, "failed", { error: err }) };
}

export async function land(d: FeeDeps, job: Job): Promise<Landed> {
  if (low && !job.urgent) return { state: "skipped" };
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
