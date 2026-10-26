// The daily batch (D-03, D-13, D-19, D-20): at FEE_BATCH_HOUR_UTC the worker settles pending rows past their
// blockhash (WR-01), burns the buyback wallet's BONDR, pays out the post-bond fees of finalized coins, retries the
// bond and finalize of pooled coins still at none, then reconciles (fee-reconcile.ts). Coins come from the
// engine's memory, so the run wakes Neon once, for the pending and reconcile reads and the sends' own rows. Every send goes through its coin's queue, so it never overlaps that
// coin's other jobs; below the ops floor the sends are skipped and only the reconcile runs.
import { distributeMin } from "@bondr/core/fees";
import { redact } from "@bondr/core/net";
import { toSol } from "@bondr/core/price";
import {
  canonicalPumpPoolPdaWithQuote,
  coinCreatorVaultAtaPda,
  coinCreatorVaultAuthorityPda,
  creatorVaultPda,
  feeSharingConfigPda,
  PUMP_AMM_SDK,
  PUMP_SDK,
} from "@bondr/core/pump";
import { distributeIxs } from "@bondr/core/sharing";
import {
  AccountLayout,
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { AccountInfo, ConfirmedTransactionMeta, PublicKey } from "@solana/web3.js";
import { bondedJob } from "./fee-burns.ts";
import type { Engine } from "./fee-engine.ts";
import { tokenBalance } from "./fee-prebond.ts";
import { reconcile } from "./fee-reconcile.ts";
import { settleStale } from "./fee-recover.ts";
import { type FeeCoin, type FeeDeps, factsFor, type Landed, refreshOps } from "./fee-send.ts";
import { mark } from "./health.ts";

const DECIMALS = 6; // BONDR, the quote mint (price.ts)
const DONE: Landed = { state: "done" };
const SKIPPED: Landed = { state: "skipped" };
const DISTRIBUTE_CU = 400_000;
// D-19, A8: the signature fee plus budget()'s priority price (1,000 micro-lamports per CU) at this limit.
const DISTRIBUTE_FEE = 5_000 + Math.ceil((DISTRIBUTE_CU * 1_000) / 1_000_000);
const DAY_MS = 86_400_000;

const logged = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

export type BatchEngine = Pick<Engine, "coins" | "enqueue" | "busy">;
export type BatchSummary = {
  opsLow: boolean;
  burn: Landed["state"];
  distribute: number;
  finalize: number;
  accounts: number;
  diffs: number;
};

// D-13, T-05-09-01: the buyback's whole BONDR balance in one BurnChecked (a burn, never a transfer), signed by
// the buyback key with ops paying. The platform row has no mint.
export async function buybackBurnJob(d: FeeDeps): Promise<Landed> {
  if (d.allowed && !d.allowed("buybackBurn", null)) return SKIPPED;
  if (!d.sim) mark("buyback");
  const owner = d.buyback.publicKey;
  const amount = await tokenBalance(d, owner);
  if (amount === 0n) return DONE;
  const ata = getAssociatedTokenAddressSync(d.Q, owner, true, T22);
  const ix = createBurnCheckedInstruction(ata, d.Q, owner, amount, DECIMALS, [], T22);
  const row = { kind: "buyback_burn" as const, mint: null, amount, burned: amount };
  return d.land({ rows: [row], ixs: [ix], signers: [d.buyback] });
}

const amountOf = (info: AccountInfo<Buffer> | null): bigint =>
  info ? AccountLayout.decode(info.data).amount : 0n;

// Pitfall 9: the program's minimum view is SOL-only, so pending is read directly: the pool's creator bucket
// plus the sharing config's AMM and pump vault ATAs, with the config itself, in one call. Null before finalize.
async function pendingOf(d: FeeDeps, mint: PublicKey) {
  const config = feeSharingConfigPda(mint);
  const [pool, amm, pump, cfg] = await d.conn.getMultipleAccountsInfo([
    canonicalPumpPoolPdaWithQuote(mint, d.Q),
    coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(config), d.Q, T22),
    getAssociatedTokenAddressSync(d.Q, creatorVaultPda(config), true, T22),
    config,
  ]);
  if (!cfg) return null;
  const bucket = pool ? BigInt(PUMP_AMM_SDK.decodePool(pool).creatorFees.toString()) : 0n;
  const holders = PUMP_SDK.decodeSharingConfig(cfg).shareholders;
  return { pending: bucket + amountOf(amm) + amountOf(pump), holders };
}

// D-19: worth it only while the ops fee is under 1% of the payout; with no BONDR price yet, any fees are (as a
// collect, D-11). The owner's Distribute now (anyAmount, D-16) skips the minimum but never pays nothing.
function worthPaying(d: FeeDeps, pending: bigint, anyAmount = false): boolean {
  if (pending <= 0n) return false;
  if (anyAmount) return true;
  const price = d.bondrSol();
  return price === null || toSol(pending, price) >= distributeMin(DISTRIBUTE_FEE);
}

// FEE-07, T-05-09-02: permissionless, ops pays, and the SDK pays the shareholders the verified finalize locked;
// the engine names no recipient. The row's split is the two holders' BONDR deltas in this tx's own meta.
export async function distributeJob(
  d: FeeDeps,
  coin: FeeCoin,
  o: { anyAmount?: boolean } = {},
): Promise<Landed> {
  if (d.allowed && !d.allowed("finalize", coin)) return SKIPPED;
  if (!d.sim) mark("distribute");
  const p = await pendingOf(d, coin.mint);
  const [deployer, treasury] = p?.holders ?? [];
  if (!p || !deployer || !treasury || !worthPaying(d, p.pending, o.anyAmount)) return DONE;
  const ixs = await distributeIxs({
    online: d.online,
    mint: coin.mint,
    quoteMint: d.Q,
    payer: d.ops.publicKey,
  });
  const detail = {
    ...{ dBps: deployer.shareBps, tBps: treasury.shareBps },
    ...{ deployer: deployer.address.toBase58(), treasury: treasury.address.toBase58() },
  };
  const row = { kind: "distribute" as const, mint: coin.mint.toBase58(), detail };
  const facts = (meta: ConfirmedTransactionMeta) => factsFor([row], meta, d.Q);
  return d.land({ rows: [row], ixs, signers: [], cu: DISTRIBUTE_CU, facts });
}

// The burn, then each finalized coin's payout and each pooled coin's retry (bondedJob: the bond burn if it is
// missing, then finalize, as at boot), each on its own coin's queue.
async function sends(d: FeeDeps, engine: BatchEngine, s: BatchSummary): Promise<void> {
  const burn = async () => {
    s.burn = (await buybackBurnJob(d)).state;
  };
  await engine.enqueue("platform", burn, "buyback burn");
  const runs = [...engine.coins.values()].map((coin) => {
    const mint = coin.mint.toBase58();
    // Each returns its result so the engine can mark a failing step stuck (D-20).
    const pay = async () => {
      const out = await distributeJob(d, coin);
      if (out.state === "landed") s.distribute++;
      return out;
    };
    const retry = async () => {
      s.finalize++;
      const out = await bondedJob(d, coin);
      console.log(`fee batch bonded ${mint}: ${out.map((l) => l.state).join(", ")}`);
      return out;
    };
    if (coin.finalize === "done") return engine.enqueue(mint, pay, `fee distribute ${mint}`);
    if (coin.venue === "pool" && coin.finalize === "none")
      return engine.enqueue(mint, retry, `fee bonded ${mint}`);
    return undefined;
  });
  await Promise.all(runs);
}

export async function runBatch(d: FeeDeps, engine: BatchEngine): Promise<BatchSummary> {
  const s: BatchSummary = {
    opsLow: await refreshOps(d),
    burn: "skipped",
    distribute: 0,
    finalize: 0,
    accounts: 0,
    diffs: 0,
  };
  const left = await settleStale(d, (m) => engine.coins.get(m)).catch(logged("fee batch settle"));
  if (left) console.error(`fee batch: ${left} signatures still pending`);
  if (!s.opsLow) await sends(d, engine, s);
  Object.assign(s, await reconcile(d, engine.coins, engine.busy));
  console.log(`fee batch: ${JSON.stringify(s)}`);
  return s;
}

// The next run: today at the hour (UTC) when it is still ahead, else tomorrow.
export function nextBatchAt(now: number, hour: number): number {
  const at = new Date(now).setUTCHours(hour, 0, 0, 0);
  return at > now ? at : at + DAY_MS;
}

let wired: { d: FeeDeps; engine: BatchEngine } | null = null;
let running: Promise<BatchSummary> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

// The timer and POST /fee/batch: one run at a time, and a call during a run gets that run. Null until the
// engine has started (FEE_ENGINE off never wires it).
export function batchNow(): Promise<BatchSummary> | null {
  if (!wired) return null;
  running ??= runBatch(wired.d, wired.engine).finally(() => {
    running = null;
  });
  return running;
}

// D-03: one in-memory timer; it reads nothing itself and re-arms after each run, whatever the outcome.
export function scheduleBatch(d: FeeDeps, engine: BatchEngine, hour: number): void {
  wired = { d, engine };
  clearTimeout(timer);
  const fire = () =>
    void batchNow()
      ?.catch(logged("fee batch"))
      .finally(() => scheduleBatch(d, engine, hour));
  timer = setTimeout(fire, nextBatchAt(Date.now(), hour) - Date.now());
  timer.unref();
}
