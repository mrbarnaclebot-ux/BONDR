// SPIKE-03 pre-bond fee path (fork): sim v3 trades on the 150 bps child C0, a worker-style sweep + collect
// of W0's creator fees, then the off-chain 90/10 split (PROJECT.md items 3 and 4, D-10, D-12). The forced
// bond in plan 01-07 spends the 90% left in W0.
import { collectIxs, splitIxs } from "@bondr/core/collect";
import { costToComplete } from "@bondr/core/curve";
import { split90_10 } from "@bondr/core/math";
import {
  BN,
  type Global,
  getBuyV3TokenAmountFromQuoteAmount,
  getSellSolAmountFromTokenAmount,
  OnlinePumpSdk,
} from "@bondr/core/pump";
import { budget, fetchMeta, sendTx } from "@bondr/core/send";
import { buyExactIn, sellExactIn } from "@bondr/core/trade";
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import {
  type ConfirmedTransactionMeta,
  type Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import { fundSol } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";
import { tokenAmount } from "./launch.ts";
import { tokenDelta } from "./multihop.ts";

const CU = 300_000;
const TRADER_SOL = 20 * LAMPORTS_PER_SOL;
const BUYQ_SOL = new BN(2 * LAMPORTS_PER_SOL);
type Online = InstanceType<typeof OnlinePumpSdk>;
type Facts = Record<string, string | number>;
type Run = {
  ctx: Ctx;
  online: Online;
  g: Global;
  Q: PublicKey;
  C0: PublicKey;
  trader: Keypair;
  volumeQ: bigint;
};
type Tx = { id: string; step: string; payer: Keypair; ixs: TransactionInstruction[]; signers?: Keypair[] };

const abs = (x: bigint): bigint => (x < 0n ? -x : x);
const bal = async (run: Run, mint: PublicKey, owner: PublicKey) =>
  BigInt(await tokenAmount(run.ctx, mint, owner));

// One landed tx per row; the facts come from the landed meta, so the row proves what moved.
async function land(
  run: Run,
  tx: Tx,
  facts: (m: ConfirmedTransactionMeta) => Facts | Promise<Facts>,
): Promise<void> {
  const ixs = [...budget(CU), ...tx.ixs];
  const r = await sendTx({ conn: run.ctx.conn, payer: tx.payer, signers: tx.signers, ixs });
  const meta = r.ok && r.sig ? await fetchMeta(run.ctx.conn, r.sig) : undefined;
  run.ctx.record({ id: tx.id, step: tx.step, ...r, cuLimit: CU, facts: meta ? await facts(meta) : {} });
  if (!r.ok || !meta) throw new Error(`${tx.id} failed: ${r.err ?? "no meta"}`);
}

// Pitfall 1: Q must stay below half of its completion raise; plan 01-07's whale needs the rest.
async function guardQ(run: Run, spend: BN): Promise<void> {
  const [curve, cost] = await Promise.all([
    run.online.fetchBondingCurve(run.Q),
    costToComplete(run.online, run.Q),
  ]);
  const total = curve.realQuoteReserves.add(cost);
  if (curve.realQuoteReserves.add(spend).muln(2).gte(total))
    throw new Error(
      `Q would pass 50% of completion: reserves ${curve.realQuoteReserves}, spend ${spend}, total ${total}`,
    );
}

async function fundTrader(run: Run): Promise<void> {
  await fundSol(run.ctx, run.trader.publicKey, TRADER_SOL);
}

async function quoteOut(run: Run, mint: PublicKey, spend: BN): Promise<BN> {
  const [fc, s] = await Promise.all([
    run.online.fetchFeeConfig(),
    run.online.fetchBuyState(mint, run.trader.publicKey, T22),
  ]);
  const o = { global: run.g, feeConfig: fc, bondingCurve: s.bondingCurve, amount: spend };
  const out = getBuyV3TokenAmountFromQuoteAmount({
    ...o,
    mintSupply: s.bondingCurve.tokenTotalSupply,
    curveBaseTokenBalance: s.curveBaseTokenBalance,
  });
  return out.muln(99).divn(100); // 1% slippage floor
}

async function buyQ(run: Run): Promise<void> {
  await guardQ(run, BUYQ_SOL);
  const user = run.trader.publicKey;
  const minOut = await quoteOut(run, run.Q, BUYQ_SOL);
  const ixs = await buyExactIn({
    global: run.g,
    mint: run.Q,
    user,
    quoteMint: NATIVE_MINT,
    spend: BUYQ_SOL,
    minOut,
  });
  const tx = {
    id: "prebond.buyq",
    step: "Trader buy_exact_quote_in_v3 on Q with 2 SOL",
    payer: run.trader,
    ixs,
  };
  await land(run, tx, (m) => ({
    spend: BUYQ_SOL.toString(),
    minOut: minOut.toString(),
    qOut: tokenDelta(m, run.Q, user).toString(),
  }));
}

async function tradeIxs(
  run: Run,
  buy: boolean,
): Promise<{ ixs: TransactionInstruction[]; amountIn: BN; min: BN }> {
  const side = { global: run.g, mint: run.C0, user: run.trader.publicKey, quoteMint: run.Q };
  if (buy) {
    const spend = new BN((await bal(run, run.Q, side.user)).toString()).divn(2);
    if (spend.gte(await costToComplete(run.online, run.C0))) throw new Error("buy would complete C0");
    const minOut = await quoteOut(run, run.C0, spend);
    return { ixs: await buyExactIn({ ...side, spend, minOut }), amountIn: spend, min: minOut };
  }
  const amount = new BN((await bal(run, run.C0, side.user)).toString());
  const [fc, s] = await Promise.all([
    run.online.fetchFeeConfig(),
    run.online.fetchSellState(run.C0, side.user, T22),
  ]);
  const bc = s.bondingCurve;
  const q = getSellSolAmountFromTokenAmount({
    global: run.g,
    feeConfig: fc,
    mintSupply: bc.tokenTotalSupply,
    bondingCurve: bc,
    amount,
  });
  const minQuote = q.muln(95).divn(100); // 5% floor: the SOL-named quote helper is a price check, not exact
  return { ixs: await sellExactIn({ ...side, amount, minQuote }), amountIn: amount, min: minQuote };
}

// Odd n buys C0 with half the trader's Q, even n sells the whole C0 balance back to Q.
async function trade(run: Run, n: number): Promise<void> {
  const buy = n % 2 === 1;
  const { ixs, amountIn, min } = await tradeIxs(run, buy);
  const user = run.trader.publicKey;
  const step = buy ? `Trader buy_exact_quote_in_v3 C0 with Q (${n})` : `Trader sell_v3 all C0 to Q (${n})`;
  await land(run, { id: `prebond.trade.${n}`, step, payer: run.trader, ixs }, (m) => {
    const qDelta = tokenDelta(m, run.Q, user);
    run.volumeQ += abs(qDelta);
    const side = buy ? "buy" : "sell";
    return {
      side,
      amountIn: amountIn.toString(),
      min: min.toString(),
      qDelta: qDelta.toString(),
      c0Delta: tokenDelta(m, run.C0, user).toString(),
    };
  });
}

// Permissionless: ops pays, W0 does not sign. collected is W0's Q delta in this tx's meta, never W0's whole
// balance, so a rerun on a W that already holds a burn budget never skims that budget again.
async function collect(run: Run, W: PublicKey): Promise<{ collected: bigint; wBefore: bigint }> {
  const ops = run.ctx.key("ops", "main");
  const before = await bal(run, run.Q, W);
  const ixs = await collectIxs({
    online: run.online,
    payer: ops.publicKey,
    mint: run.C0,
    creator: W,
    quoteMint: run.Q,
  });
  const step = "Sweep + collect_creator_fee_v2 of W0's C0 fees (ops pays, W0 not a signer)";
  let collected = 0n;
  await land(run, { id: "prebond.collect", step, payer: ops, ixs }, (m) => {
    collected = tokenDelta(m, run.Q, W);
    // Two decimals of bps; gross Q deltas, so buys read a little under 150 and sells a little over.
    const effectiveCreatorBps = Number((collected * 1_000_000n) / run.volumeQ) / 100;
    const volumeQ = run.volumeQ.toString();
    return {
      W: W.toBase58(),
      wBefore: before.toString(),
      collected: collected.toString(),
      volumeQ,
      effectiveCreatorBps,
    };
  });
  return { collected, wBefore: before };
}

// Pitfall 3: W0 gets a rent-exempt floor from ops in the same tx when it holds less.
async function wFloat(
  run: Run,
  ops: Keypair,
  W: PublicKey,
): Promise<{ ixs: TransactionInstruction[]; lamports: number }> {
  const need = (await run.ctx.conn.getMinimumBalanceForRentExemption(0)) - (await run.ctx.conn.getBalance(W));
  if (need <= 0) return { ixs: [], lamports: 0 };
  return {
    ixs: [SystemProgram.transfer({ fromPubkey: ops.publicKey, toPubkey: W, lamports: need })],
    lamports: need,
  };
}

async function split(run: Run, Wk: Keypair, c: { collected: bigint; wBefore: bigint }): Promise<void> {
  const { collected } = c;
  const [ops, treasury, W] = [
    run.ctx.key("ops", "main"),
    run.ctx.key("treasury", "main").publicKey,
    Wk.publicKey,
  ];
  const { treasury: treasuryAmount, burn } = split90_10(collected);
  const decimals = (await run.ctx.conn.getTokenSupply(run.Q)).value.decimals;
  const treasuryBefore = await bal(run, run.Q, treasury);
  const float = await wFloat(run, ops, W);
  const ixs = [
    ...float.ixs,
    ...splitIxs({ payer: ops.publicKey, creator: W, treasury, quoteMint: run.Q, treasuryAmount, decimals }),
  ];
  const step = "90/10 split: W0 sends 10% of the collect to the treasury Q ATA (ops pays)";
  await land(run, { id: "prebond.split", step, payer: ops, signers: [Wk], ixs }, async (m) => ({
    collected: collected.toString(),
    wBeforeCollect: c.wBefore.toString(),
    treasuryDelta: tokenDelta(m, run.Q, treasury).toString(),
    wDelta: tokenDelta(m, run.Q, W).toString(),
    treasuryAmount: treasuryAmount.toString(),
    burn: burn.toString(),
    treasuryBefore: treasuryBefore.toString(),
    treasuryAfter: (await bal(run, run.Q, treasury)).toString(),
    wAfter: (await bal(run, run.Q, W)).toString(),
    wFloatLamports: float.lamports,
  }));
}

const sigOk: Rule = (row) => (row.sig ? null : "no signature");

const collectRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (BigInt(f.collected ?? 0) <= 0n) return `collected ${f.collected} is not above 0`;
  const bps = Number(f.effectiveCreatorBps);
  return bps >= 140 && bps <= 160 ? null : `effectiveCreatorBps ${bps} outside 140..160`;
};

// The split is sized off the collect row's own delta (T-01-20): the treasury gains floor(delta / 10), W loses
// exactly that, and W keeps its prior balance plus the other 90%.
const splitRule: Rule = (row, file) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  const fromCollect = file.rows.find((r) => r.id === "prebond.collect")?.facts?.collected;
  const [collected, amount] = [BigInt(f.collected ?? -1), BigInt(f.treasuryAmount ?? -1)];
  if (String(fromCollect) !== String(f.collected))
    return `split used ${f.collected}, collect delta ${fromCollect}`;
  if (amount !== collected / 10n) return `treasuryAmount ${amount} is not floor(${collected} / 10)`;
  const moved = BigInt(f.treasuryAfter ?? 0) - BigInt(f.treasuryBefore ?? 0);
  if (moved !== amount || BigInt(f.treasuryDelta ?? 0) !== amount)
    return `treasury moved ${moved}, expected ${amount}`;
  if (BigInt(f.wDelta ?? 0) !== -amount) return `W moved ${f.wDelta}, expected -${amount}`;
  const keep = BigInt(f.wBeforeCollect ?? 0) + collected - amount;
  return BigInt(f.wAfter ?? -1) === keep ? null : `W holds ${f.wAfter}, expected ${keep}`;
};

export const prebondStage: Stage = {
  name: "prebond",
  rules: () => ({
    "prebond.buyq": sigOk,
    ...Object.fromEntries([1, 2, 3, 4].map((n) => [`prebond.trade.${n}`, sigOk])),
    "prebond.collect": collectRule,
    "prebond.split": splitRule,
  }),
  async run(ctx) {
    const { Q, C0 } = ctx.file.state;
    if (!Q || !C0) throw new Error("no Q or C0 in state: run the create stage first");
    const online = new OnlinePumpSdk(ctx.conn);
    const trader = ctx.key("sim", "trader");
    const run: Run = {
      ctx,
      online,
      g: await online.fetchGlobal(),
      Q: new PublicKey(Q),
      C0: new PublicKey(C0),
      trader,
      volumeQ: 0n,
    };
    await fundTrader(run);
    await buyQ(run);
    for (const n of [1, 2, 3, 4]) await trade(run, n);
    if (run.volumeQ === 0n) throw new Error("no Q volume recorded from the trades");
    const W = ctx.key("w", C0);
    await split(run, W, await collect(run, W.publicKey));
  },
};
