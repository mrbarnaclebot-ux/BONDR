// SPIKE-05: multi_hop_swap buy SOL -> Q -> C0 and sell C0 -> Q -> SOL, one signature each. Out amounts come
// from the landed tx meta, so the row proves what the trader got, not what the simulation promised.
import { costToComplete } from "@bondr/core/curve";
import { BN, OnlinePumpSdk } from "@bondr/core/pump";
import { type Route, routeBuy, routeSell } from "@bondr/core/route";
import { budget, fetchMeta, sendTx } from "@bondr/core/send";
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

export function tokenDelta(meta: ConfirmedTransactionMeta, mint: PublicKey, owner: PublicKey): bigint {
  const pick = (list: ConfirmedTransactionMeta["preTokenBalances"]) =>
    BigInt(
      list?.find((b) => b.mint === mint.toBase58() && b.owner === owner.toBase58())?.uiTokenAmount.amount ??
        "0",
    );
  return pick(meta.postTokenBalances) - pick(meta.preTokenBalances);
}

// The trader is the fee payer (account 0), so adding the fee back leaves what the sell paid out.
const lamportDelta = (meta: ConfirmedTransactionMeta): bigint =>
  BigInt(meta.postBalances[0] - meta.preBalances[0] + meta.fee);

// Pitfall 1: a route that completed Q would block every child create (6107) before the plan wants it.
async function guardQ(online: Online, Q: PublicKey, amountIn: BN): Promise<void> {
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
    ...(meta && { outAmount: out(meta).toString() }),
  };
  ctx.record({ id: leg.id, step: leg.step, ...r, cuLimit: CU, facts });
  return r.ok;
}

async function c0Balance(ctx: Ctx, C0: PublicKey, owner: PublicKey): Promise<BN> {
  const ata = getAssociatedTokenAddressSync(C0, owner, true, T22);
  if (!(await ctx.conn.getAccountInfo(ata))) return new BN(0);
  return new BN((await ctx.conn.getTokenAccountBalance(ata)).value.amount);
}

async function buy(ctx: Ctx, online: Online, Q: PublicKey, C0: PublicKey, amountIn: BN): Promise<void> {
  const user = ctx.key("sim", "trader").publicKey;
  await guardQ(online, Q, amountIn);
  await fundSol(ctx, user, amountIn.toNumber() + TRADER_FLOAT);
  const opts = { online, user, amountIn, slippageBps: SLIPPAGE_BPS };
  const route = await routeBuy({ ...opts, path: [NATIVE_MINT, Q, C0] });
  const leg = { id: "multihop.buy", step: "multi_hop_swap buy SOL -> Q -> C0", route, amountIn };
  if (!(await send(ctx, leg, (m) => tokenDelta(m, C0, user)))) throw new Error("multihop buy failed");
}

async function sell(ctx: Ctx, online: Online, Q: PublicKey, C0: PublicKey): Promise<void> {
  const user = ctx.key("sim", "trader").publicKey;
  const amountIn = await c0Balance(ctx, C0, user);
  if (amountIn.isZero()) throw new Error("trader holds no C0 to sell: rerun with SPIKE_FRESH=1");
  const route = await routeSell({
    online,
    user,
    amountIn,
    slippageBps: SLIPPAGE_BPS,
    path: [C0, Q, NATIVE_MINT],
  });
  const leg = { id: "multihop.sell", step: "multi_hop_swap sell C0 -> Q -> SOL", route, amountIn };
  if (!(await send(ctx, leg, lamportDelta))) throw new Error("multihop sell failed");
}

const legRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.outAmount === undefined) return "outAmount missing";
  const [out, min] = [BigInt(f.outAmount), BigInt(f.minAmountOut ?? 0)];
  if (min <= 0n) return `minAmountOut ${min} is not above 0`;
  return out >= min ? null : `outAmount ${out} < minAmountOut ${min}`;
};

export const multihopStage: Stage = {
  name: "multihop",
  rules: () => ({ "multihop.buy": legRule, "multihop.sell": legRule }),
  async run(ctx) {
    const { Q, C0 } = ctx.file.state;
    if (!Q || !C0) throw new Error("no Q or C0 in state: run the create stage first");
    const online = new OnlinePumpSdk(ctx.conn);
    const g = await online.fetchGlobal();
    // Pitfall 1 budget: devnet curves are 100x cheaper, so the devnet amount scales off the live Global.
    const amountIn = ctx.net === "fork" ? new BN(LAMPORTS_PER_SOL) : g.initialVirtualSolReserves.divn(200);
    const [q, c0] = [new PublicKey(Q), new PublicKey(C0)];
    const bought = ctx.file.rows.some((r) => r.id === "multihop.buy" && r.ok);
    if (!bought || process.env.SPIKE_FRESH === "1" || ctx.net === "fork")
      await buy(ctx, online, q, c0, amountIn);
    await sell(ctx, online, q, c0);
  },
};
