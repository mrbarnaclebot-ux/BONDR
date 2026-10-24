// SPIKE-05: multi_hop_swap buy SOL -> Q -> C and sell C -> Q -> SOL, one signature each. Out amounts come
// from the landed tx meta, so the row proves what the trader got, not what the simulation promised. One
// factory serves both routes: devnet C0 with Q on its curve, and fork C3 with Q on its PumpSwap pool. The
// SDK picks each hop's venue from chain.
import { costToComplete, readCurve } from "@bondr/core/curve";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { type Route, routeBuy, routeSell } from "@bondr/core/route";
import { budget, fetchMeta, sendTx } from "@bondr/core/send";
import { lamportDelta, tokenDelta } from "@bondr/core/trade";
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { type ConfirmedTransactionMeta, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fundSol, paceMs } from "../fund.ts";
import type { Ctx, Rule, Stage } from "../results.ts";

const CU = 600_000;
const SLIPPAGE_BPS = 500;
// Spend estimate on top of amountIn: WSOL and C0 ATAs, the volume accumulator, fees. Leftovers stay put.
const TRADER_FLOAT = 0.02 * LAMPORTS_PER_SOL;
type Online = InstanceType<typeof OnlinePumpSdk>;
type Leg = { id: string; step: string; route: Route; amountIn: BN };
type Hop = { ctx: Ctx; online: Online; Q: PublicKey; C: PublicKey; prefix: string; label: string };

// Pitfall 1: a route that completed Q would block every child create (6107) before the plan wants it.
// A migrated Q trades on its pool, so the guard only applies while Q is on its curve.
async function guardQ(online: Online, Q: PublicKey, amountIn: BN): Promise<void> {
  if ((await readCurve(online, Q)).complete) return;
  const cost = await costToComplete(online, Q);
  if (amountIn.gte(cost))
    throw new Error(
      `would complete Q outside its planned state: amountIn ${amountIn}, Q completes at ${cost}`,
    );
}

async function send(ctx: Ctx, leg: Leg, out: (m: ConfirmedTransactionMeta) => bigint): Promise<boolean> {
  const trader = ctx.key("sim", "trader");
  const ixs = [...budget(CU), ...leg.route.ixs];
  const r = await sendTx({ conn: ctx.conn, payer: trader, ixs, paceMs: paceMs(ctx) });
  const meta = r.ok && r.sig ? await fetchMeta(ctx.conn, r.sig) : undefined;
  const facts = {
    amountIn: leg.amountIn.toString(),
    expectedOut: leg.route.expectedOut.toString(),
    minAmountOut: leg.route.minAmountOut.toString(),
    venues: leg.route.venues,
    ...(meta && { outAmount: out(meta).toString() }),
  };
  ctx.record({ id: leg.id, step: leg.step, ...r, cuLimit: CU, facts });
  return r.ok;
}

async function coinBalance(ctx: Ctx, C: PublicKey, owner: PublicKey): Promise<BN> {
  const ata = getAssociatedTokenAddressSync(C, owner, true, T22);
  if (!(await ctx.conn.getAccountInfo(ata))) return new BN(0);
  return new BN((await ctx.conn.getTokenAccountBalance(ata)).value.amount);
}

async function buy(h: Hop, amountIn: BN): Promise<void> {
  const user = h.ctx.key("sim", "trader").publicKey;
  await guardQ(h.online, h.Q, amountIn);
  await fundSol(h.ctx, user, amountIn.toNumber() + TRADER_FLOAT);
  const opts = { online: h.online, user, amountIn, slippageBps: SLIPPAGE_BPS };
  const route = await routeBuy({ ...opts, path: [NATIVE_MINT, h.Q, h.C] });
  const step = `multi_hop_swap buy SOL -> Q -> ${h.label}`;
  const leg = { id: `${h.prefix}multihop.buy`, step, route, amountIn };
  if (!(await send(h.ctx, leg, (m) => tokenDelta(m, h.C, user)))) throw new Error("multihop buy failed");
}

async function sell(h: Hop): Promise<void> {
  const user = h.ctx.key("sim", "trader").publicKey;
  const amountIn = await coinBalance(h.ctx, h.C, user);
  if (amountIn.isZero()) throw new Error(`trader holds no ${h.label} to sell: rerun with SPIKE_FRESH=1`);
  const route = await routeSell({
    online: h.online,
    user,
    amountIn,
    slippageBps: SLIPPAGE_BPS,
    path: [h.C, h.Q, NATIVE_MINT],
  });
  const step = `multi_hop_swap sell ${h.label} -> Q -> SOL`;
  const leg = { id: `${h.prefix}multihop.sell`, step, route, amountIn };
  if (!(await send(h.ctx, leg, lamportDelta))) throw new Error("multihop sell failed");
}

const legRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.outAmount === undefined) return "outAmount missing";
  const [out, min] = [BigInt(f.outAmount), BigInt(f.minAmountOut ?? 0)];
  if (min <= 0n) return `minAmountOut ${min} is not above 0`;
  return out >= min ? null : `outAmount ${out} < minAmountOut ${min}`;
};

// coinKey names the routed coin in file.state; idPrefix keeps devnet's ids ("") so passed rows still skip.
export const multihopStage = (coinKey: string, idPrefix: string): Stage => ({
  name: `${idPrefix}multihop`,
  rules: () => ({ [`${idPrefix}multihop.buy`]: legRule, [`${idPrefix}multihop.sell`]: legRule }),
  async run(ctx) {
    const { Q, [coinKey]: C } = ctx.file.state;
    if (!Q || !C) throw new Error(`no Q or ${coinKey} in state: run the stage that creates it first`);
    const online = new OnlinePumpSdk(ctx.conn);
    const g = await online.fetchGlobal();
    // Pitfall 1 budget: devnet curves are 100x cheaper, so the devnet amount scales off the live Global.
    const amountIn = ctx.net === "fork" ? new BN(LAMPORTS_PER_SOL) : g.initialVirtualSolReserves.divn(200);
    const h = { ctx, online, Q: new PublicKey(Q), C: new PublicKey(C), prefix: idPrefix, label: coinKey };
    const bought = ctx.file.rows.some((r) => r.id === `${idPrefix}multihop.buy` && r.ok);
    if (!bought || process.env.SPIKE_FRESH === "1" || ctx.net === "fork") await buy(h, amountIn);
    await sell(h);
  },
});
