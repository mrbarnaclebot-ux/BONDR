// Boot, deps wiring and the engine singleton, split from fee-engine.ts for the 300-line rule: the one boot
// read, the deps every fee job runs with, the ingest hook announce calls, and the cost-to-complete pricing.
import { costFromReserves } from "@bondr/core/curve";
import { coins, db, launches } from "@bondr/core/db";
import { derive } from "@bondr/core/keys";
import { OnlinePumpAmmSdk, type OnlinePumpSdk } from "@bondr/core/pump";
import type { CoinPatch, Parsed } from "@bondr/core/trades";
import type { Connection, PublicKey } from "@solana/web3.js";
import { eq, type SQL } from "drizzle-orm";
import { publishFee } from "./announce.ts";
import { bondrPrice } from "./bondr-price.ts";
import { buyback, ops, type WorkerEnv } from "./env.ts";
import { scheduleBatch } from "./fee-batch.ts";
import { feeConfig } from "./fee-config.ts";
import { type CoinLoad, coinFrom, Engine, type Ingested, logged, type WOf } from "./fee-engine.ts";
import { pgLedger } from "./fee-ledger.ts";
import { recover } from "./fee-recover.ts";
import { type FeeCoin, type FeeDeps, land, noteOps } from "./fee-send.ts";
import type { Ctx } from "./status.ts";
import { switchOn } from "./switches.ts";
import { configs } from "./trade-state.ts";

let engine: Engine | null = null;
export const feeEngine = (): Engine | null => engine;
let costCtx: { net: WorkerEnv["net"]; Q: PublicKey; wOf: WOf } | null = null; // set in every mode

// Called by announce after every committed ingest, live and gap fill. Before startEngine it is a no-op.
export const onIngest = (w: Ingested): void => engine?.onIngest(w);

// One boot read: every coin with its launch's W, signature, wallet and manual hold.
const loadRows = (where?: SQL): Promise<CoinLoad[]> =>
  db()
    .select({
      ...{ mint: coins.mint, w: launches.w, launchSig: launches.signature, wallet: launches.wallet },
      ...{ launchedAt: coins.launchedAt, venue: coins.venue, feeBudget: coins.feeBudget },
      ...{ feesUnclaimed: coins.feesUnclaimed, cost: coins.costToComplete, finalize: coins.finalize },
      heldReason: coins.heldReason,
    })
    .from(coins)
    .innerJoin(launches, eq(launches.id, coins.launchId))
    .where(where);

// One coin for the admin path with the engine off (A1); undefined before startEngine or for another seed's W.
export async function loadCoin(mint: string): Promise<FeeCoin | undefined> {
  const c = costCtx;
  const [r] = c ? await loadRows(eq(coins.mint, mint)) : [];
  return r && c ? coinFrom(r, c.wOf) : undefined;
}

// Every coin whose W derives from this seed, for EVACUATE (06-22); [] before startEngine.
export async function loadFeeCoins(): Promise<FeeCoin[]> {
  const c = costCtx;
  return c ? (await loadRows()).flatMap((r) => coinFrom(r, c.wOf) ?? []) : [];
}

export function feeDeps(ctx: Ctx, env: WorkerEnv, mode: "dry" | "on"): FeeDeps {
  const d: FeeDeps = {
    ...{ net: env.net, mode, conn: ctx.conn, Q: ctx.Q, ledger: pgLedger(), windowMs: env.feeWindowMs },
    online: ctx.online as InstanceType<typeof OnlinePumpSdk>,
    amm: new OnlinePumpAmmSdk(ctx.conn),
    ops: ops(env.seed, env.net),
    treasury: env.treasury,
    buyback: buyback(env.seed, env.net, env.lane),
    bondrSol: () => bondrPrice.get(),
    publish: (mint, rows) => {
      engine?.landed(mint, rows);
      publishFee(mint, rows).catch(logged("fee publish"));
    },
    land: (job) => land(d, job),
    // D-16, D-19: automatic jobs obey the owner's switches and a coin's manual hold; admin deps override this.
    allowed: (job, coin) => switchOn(job) && !coin?.hold,
  };
  return d;
}

// Boot, after loadCoins and before the backfill and the stream: load, settle every pending row, then arm.
// A retried index boot keeps an engine that already started, so no window is ever armed twice.
export async function startEngine(ctx: Ctx, env: WorkerEnv): Promise<void> {
  const wOf: WOf = (mint) => derive(env.seed, "w", env.net, mint);
  costCtx = { net: env.net, Q: ctx.Q, wOf };
  if (env.feeEngine === "off") return console.log("fee engine off");
  if (engine?.isReady()) return;
  const deps = feeDeps(ctx, env, env.feeEngine);
  const e = new Engine({ mode: env.feeEngine, deps, windowMs: env.feeWindowMs, wOf });
  engine = e;
  for (const r of await loadRows()) e.add(r);
  noteOps(await ctx.conn.getBalance(deps.ops.publicKey));
  await recover(deps, (m) => e.coins.get(m));
  console.log(`fee engine ${env.feeEngine}: ${e.start()} coins armed`);
  scheduleBatch(deps, e, env.feeBatchHourUtc);
}

const hasReserves = (p: CoinPatch) =>
  p.virtualTokenReserves !== undefined &&
  p.virtualQuoteReserves !== undefined &&
  p.realTokenReserves !== undefined &&
  p.realQuoteReserves !== undefined;

// Cost to complete on every curve patch, so it rides the trade write that already happens (D-23). Runs in
// every mode: the panel shows it with the engine off. A failure leaves the cost unset, never fails the write.
export async function withCost(conn: Connection, parsed: Parsed): Promise<void> {
  const c = costCtx;
  const curve = parsed.patches.filter((p) => !p.venue && hasReserves(p));
  if (!c || !curve.length) return;
  try {
    const { global, feeConfig: fc } = await configs({ conn });
    const creatorFeeBps = feeConfig(c.net).creatorFeeBps;
    for (const p of curve) {
      const ids = { creator: c.wOf(p.mint).publicKey, quoteMint: c.Q, creatorFeeBps };
      p.costToComplete = String(costFromReserves(p as Required<CoinPatch>, { global, feeConfig: fc }, ids));
    }
  } catch (e) {
    logged("cost to complete")(e);
  }
}
