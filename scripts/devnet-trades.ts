// Devnet trade generator for the indexer (03-01): the sim dev (derive(seed, "sim", net, "dev")) trades a BONDR
// coin so streams, gap fill and fixtures see real txs. One action per run. Every run tops the sim dev up when
// low (as devnet-launch --fund), refuses below OPS_FLOOR_SOL, prints ops and sim balances before and after,
// and exits 1 when the run's spend (ops plus sim SOL, net) exceeds TRADE_BUDGET_SOL = 0.05 SOL.
//   --mint MINT          the child coin (required except --bondr and --fund)
//   --buy SOL            multi_hop_swap SOL -> BONDR -> coin (default 0.01)
//   --sell               multi_hop_swap of the sim's whole coin balance -> BONDR -> SOL
//   --curve-buy BONDR    buy_exact_quote_in_v3 on the coin's curve, paying this many BONDR (UI units)
//   --curve-sell         sell_v3 of the sim's whole coin balance for BONDR
//   --bondr SOL          buy_exact_quote_in_v3 on BONDR's own curve (refused if it moves BONDR near completion)
//   --fund               only the sim dev top-up
//   --complete           A8 gate: reads the coin's completion cost and the ops balance, and refuses (exit 2) when
//                        the cost exceeds COMPLETE_BUDGET_SOL = 0.6 SOL, would take ops under the floor, or needs
//                        more BONDR than BONDR's curve holds (buying it would complete BONDR and stop launches)
//   --json               one JSON line per landed tx: { kind, sig, mint }
//   --expect-indexed S   after the run, poll the trades table for each landed signature (a running worker must
//                        index it); exit 1 when one is missing after S seconds, else print how long each took
// Run: node --env-file=.env scripts/devnet-trades.ts --mint <mint> --buy 0.01 --json
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";
import { costToComplete, readCurve } from "@bondr/core/curve";
import { close, db } from "@bondr/core/db";
import { derive } from "@bondr/core/keys";
import { connect, redact } from "@bondr/core/net";
import {
  BN,
  getBuyV3QuoteAmountFromTokenAmount,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
  OnlinePumpSdk,
} from "@bondr/core/pump";
import { routeBuy, routeSell } from "@bondr/core/route";
import { budget, sendTx } from "@bondr/core/send";
import { buyExactIn, sellExactIn } from "@bondr/core/trade";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import {
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { loadEnv, ops, quoteOf } from "../apps/worker/src/env.ts";
import { fundSimDev, OPS_FLOOR_SOL } from "./devnet-launch.ts";

export const TRADE_BUDGET_SOL = 0.05;
export const COMPLETE_BUDGET_SOL = 0.6;
const CU = 600_000;
const SLIPPAGE_BPS = 500;
const DECIMALS = 1_000_000; // BONDR and every child are 6-decimal pump coins
type Online = InstanceType<typeof OnlinePumpSdk>;
type T = { conn: Connection; online: Online; Q: PublicKey; sim: Keypair; json: boolean; landed: Landed[] };
type Landed = { sig: string; at: number };

const sol = (lamports: number): string => (lamports / LAMPORTS_PER_SOL).toFixed(6);
const floor = (x: BN, bps = 10_000 - SLIPPAGE_BPS): BN => x.muln(bps).divn(10_000);

function solIn(raw: string): BN {
  const n = Number(raw);
  if (!(n > 0 && n <= TRADE_BUDGET_SOL)) throw new Error(`SOL amount must be > 0 and <= ${TRADE_BUDGET_SOL}`);
  return new BN(Math.round(n * LAMPORTS_PER_SOL));
}

async function land(t: T, kind: string, mint: PublicKey, ixs: TransactionInstruction[]): Promise<void> {
  const r = await sendTx({ conn: t.conn, payer: t.sim, ixs: [...budget(CU), ...ixs], paceMs: 1100 });
  if (!r.ok || !r.sig) throw new Error(`${kind} ${r.status}: ${r.err ?? ""}`);
  t.landed.push({ sig: r.sig, at: Date.now() });
  const line = { kind, sig: r.sig, mint: mint.toBase58() };
  console.log(t.json ? JSON.stringify(line) : `landed ${kind} ${r.sig} (${r.bytes} B, ${r.cu} CU)`);
}

async function holding(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<BN> {
  const ata = getAssociatedTokenAddressSync(mint, owner, true, T22);
  if (!(await conn.getAccountInfo(ata))) return new BN(0);
  return new BN((await conn.getTokenAccountBalance(ata)).value.amount);
}

// Tokens a curve buy of `spend` quote returns, fees included (same SDK quote as prebond.ts).
async function curveOut(t: T, mint: PublicKey, spend: BN): Promise<BN> {
  const [global, feeConfig, s] = await Promise.all([
    t.online.fetchGlobal(),
    t.online.fetchFeeConfig(),
    t.online.fetchBuyState(mint, t.sim.publicKey, T22),
  ]);
  const bondingCurve = s.bondingCurve;
  const o = { global, feeConfig, bondingCurve, mintSupply: bondingCurve.tokenTotalSupply, amount: spend };
  return getBuyV3TokenAmountFromQuoteAmount({ ...o, curveBaseTokenBalance: s.curveBaseTokenBalance });
}

// Quote (fees included) that buys `amount` tokens from a curve: costToComplete for part of the rest.
async function curveCost(t: T, mint: PublicKey, amount: BN): Promise<BN> {
  const [global, feeConfig, s] = await Promise.all([
    t.online.fetchGlobal(),
    t.online.fetchFeeConfig(),
    t.online.fetchBuyState(mint, PublicKey.default, T22),
  ]);
  const o = { global, feeConfig, mintSupply: s.bondingCurve.tokenTotalSupply, bondingCurve: s.bondingCurve };
  return getBuyV3QuoteAmountFromTokenAmount({ ...o, amount, curveBaseTokenBalance: s.curveBaseTokenBalance });
}

async function multiHop(t: T, C: PublicKey, side: "buy" | "sell", raw: string): Promise<void> {
  const user = t.sim.publicKey;
  const amountIn = side === "buy" ? solIn(raw) : await holding(t.conn, C, user);
  if (amountIn.isZero()) throw new Error("sim holds none of the coin to sell");
  const o = { online: t.online, user, amountIn, slippageBps: SLIPPAGE_BPS };
  const r =
    side === "buy"
      ? await routeBuy({ ...o, path: [NATIVE_MINT, t.Q, C] })
      : await routeSell({ ...o, path: [C, t.Q, NATIVE_MINT] });
  console.log(`multihop ${side} ${amountIn} in, expected ${r.expectedOut} out, venues ${r.venues}`);
  await land(t, `multihop-${side}`, C, r.ixs);
}

async function curveBuy(t: T, C: PublicKey, bondrUi: string): Promise<void> {
  const spend = new BN(Math.round(Number(bondrUi) * DECIMALS));
  if (!(spend.gtn(0) && spend.lte(await holding(t.conn, t.Q, t.sim.publicKey))))
    throw new Error(`--curve-buy ${bondrUi}: must be > 0 and within the sim's BONDR (run --bondr first)`);
  if (spend.gte(await costToComplete(t.online, C))) throw new Error("curve buy would complete the coin");
  const minOut = floor(await curveOut(t, C, spend));
  const side = { global: await t.online.fetchGlobal(), mint: C, user: t.sim.publicKey, quoteMint: t.Q };
  await land(t, "curve-buy", C, await buyExactIn({ ...side, spend, minOut }));
}

async function curveSell(t: T, C: PublicKey): Promise<void> {
  const user = t.sim.publicKey;
  const amount = await holding(t.conn, C, user);
  if (amount.isZero()) throw new Error("sim holds none of the coin to sell");
  const [global, feeConfig, s] = await Promise.all([
    t.online.fetchGlobal(),
    t.online.fetchFeeConfig(),
    t.online.fetchSellState(C, user, T22),
  ]);
  const bc = s.bondingCurve;
  const out = getSellSolAmountFromTokenAmount({
    global,
    feeConfig,
    mintSupply: bc.tokenTotalSupply,
    bondingCurve: bc,
    amount,
  });
  const side = { global, mint: C, user, quoteMint: t.Q };
  await land(t, "curve-sell", C, await sellExactIn({ ...side, amount, minQuote: floor(out) }));
}

// A buy that moved BONDR past half its completion cost would put devnet launches at risk (6107 once complete).
async function bondrBuy(t: T, raw: string): Promise<void> {
  const spend = solIn(raw);
  if ((await readCurve(t.online, t.Q)).complete)
    throw new Error("BONDR has left its curve: pool buy not built");
  if (spend.gte((await costToComplete(t.online, t.Q)).divn(2)))
    throw new Error("buy moves BONDR near completion");
  const minOut = floor(await curveOut(t, t.Q, spend));
  const side = {
    global: await t.online.fetchGlobal(),
    mint: t.Q,
    user: t.sim.publicKey,
    quoteMint: NATIVE_MINT,
  };
  await land(t, "bondr-buy", t.Q, await buyExactIn({ ...side, spend, minOut }));
}

// A8. The child's completion cost is in BONDR, so its SOL price is what BONDR's own curve charges for it.
// ponytail: refuse-only; the buy-out, migration wait and pool trades are not built because a devnet child
// needs more BONDR than BONDR's curve holds (03-01 summary). Pool fixtures come from the Surfpool fork.
async function complete(t: T, C: PublicKey, opsLamports: number): Promise<void> {
  const costQ = await costToComplete(t.online, C);
  const qLeft = (await readCurve(t.online, t.Q)).realTokenReserves;
  const short = costQ.gte(qLeft);
  const costSol = (await curveCost(t, t.Q, short ? qLeft : costQ)).toNumber();
  const shown = `${short ? ">" : ""}${sol(costSol)}`;
  console.log(
    `complete: cost ${costQ} BONDR raw (BONDR curve holds ${qLeft}), ${shown} SOL; ops ${sol(opsLamports)} SOL`,
  );
  const floorHit = opsLamports - costSol - 0.05 * LAMPORTS_PER_SOL < OPS_FLOOR_SOL * LAMPORTS_PER_SOL;
  if (short || floorHit || costSol > COMPLETE_BUDGET_SOL * LAMPORTS_PER_SOL) {
    console.error(`complete refused: cost ${shown} SOL, budget ${COMPLETE_BUDGET_SOL}`);
    process.exitCode = 2;
    return;
  }
  throw new Error("complete is within budget but the buy-out path is not built: build it before running");
}

// Test-script polling, not app code: the worker under test must write each landed signature in time.
async function expectIndexed(landed: readonly Landed[], seconds: number): Promise<void> {
  for (const { sig, at: start } of landed) {
    while (!(await db().$client`select 1 from trades where signature = ${sig}`).length) {
      if (Date.now() - start > seconds * 1000) throw new Error(`${sig} not indexed within ${seconds} s`);
      await delay(1000);
    }
    console.log(`indexed ${sig} ${((Date.now() - start) / 1000).toFixed(1)} s after landing`);
  }
}

const MODES = ["buy", "sell", "curve-buy", "curve-sell", "bondr", "fund", "complete"] as const;
type Mode = (typeof MODES)[number];

function args() {
  const [s, b] = [{ type: "string" }, { type: "boolean" }] as const;
  const options = {
    mint: s,
    buy: s,
    sell: b,
    "curve-buy": s,
    "curve-sell": b,
    bondr: s,
    fund: b,
    complete: b,
    json: b,
    "expect-indexed": s,
  };
  const v = parseArgs({ options }).values as Record<string, string | boolean | undefined>;
  const set = MODES.filter((m) => v[m] !== undefined && v[m] !== false);
  if (set.length !== 1) throw new Error(`pass exactly one of --${MODES.join(", --")}`);
  const mode = set[0] as Mode;
  if (!v.mint && mode !== "bondr" && mode !== "fund") throw new Error(`--${mode} needs --mint`);
  const value = typeof v[mode] === "string" ? (v[mode] as string) : "0.01";
  const expect = v["expect-indexed"] === undefined ? undefined : Number(v["expect-indexed"]);
  if (expect !== undefined && !(expect > 0)) throw new Error("--expect-indexed takes seconds > 0");
  const mint = v.mint ? new PublicKey(v.mint) : undefined;
  return { mode, value, mint, json: v.json === true, expect };
}

async function act(t: T, mode: Mode, value: string, C: PublicKey | undefined, opsL: number): Promise<void> {
  const c = (): PublicKey => C ?? PublicKey.default;
  if (mode === "buy" || mode === "sell") return multiHop(t, c(), mode, value);
  if (mode === "curve-buy") return curveBuy(t, c(), value);
  if (mode === "curve-sell") return curveSell(t, c());
  if (mode === "bondr") return bondrBuy(t, value);
  if (mode === "complete") return complete(t, c(), opsL);
}

async function main(): Promise<void> {
  const a = args();
  const env = loadEnv();
  if (env.net !== "devnet") throw new Error("devnet only");
  const conn = await connect(env.net);
  const t: T = {
    conn,
    online: new OnlinePumpSdk(conn),
    Q: quoteOf(env),
    sim: derive(env.seed, "sim", "devnet", "dev"),
    json: a.json,
    landed: [],
  };
  const opsKey = ops(env.seed, "devnet").publicKey;
  const both = async () => Promise.all([conn.getBalance(opsKey), conn.getBalance(t.sim.publicKey)]);
  const [opsB, simB] = await both();
  console.error(`before: ops ${sol(opsB)} SOL, sim ${sol(simB)} SOL`);
  if (opsB < OPS_FLOOR_SOL * LAMPORTS_PER_SOL) throw new Error(`ops under the ${OPS_FLOOR_SOL} SOL floor`);
  if (a.mode !== "complete") await fundSimDev(conn, env.seed);
  await act(t, a.mode, a.value, a.mint, opsB);
  const [opsA, simA] = await both();
  const spend = opsB + simB - opsA - simA;
  console.error(
    `after: ops ${sol(opsA)} SOL, sim ${sol(simA)} SOL; run spend ${sol(spend)} of ${TRADE_BUDGET_SOL} SOL`,
  );
  if (spend > TRADE_BUDGET_SOL * LAMPORTS_PER_SOL) throw new Error("run spend over budget");
  if (a.expect) await expectIndexed(t.landed, a.expect);
}

if (import.meta.main)
  main()
    .catch((e: unknown) => {
      console.error(`devnet-trades failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exitCode = 1;
    })
    .finally(() => close());
