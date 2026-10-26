// The two bond burns (FEE-02, FEE-03): the forced bond when W's budget reaches 105% of the cost to complete
// (D-15), and the PumpSwap burn of W's whole budget when traders bonded first (D-17). Both are urgent, so they
// run below the ops floor (D-20), and set sender, which only takes effect on mainnet (D-16). After a forced
// bond lands, pump's keeper migrates the coin on devnet and mainnet; the fork stage migrates it itself.
import type { LedgerKind } from "@bondr/core/api";
import { forcedBondIxs, poolBaseOut, poolBuyBurnIxs, poolExactInBurnIxs } from "@bondr/core/bond";
import { costToComplete } from "@bondr/core/curve";
import { budgetOf } from "@bondr/core/fees";
import { wFloat } from "@bondr/core/float";
import { applyBps, trigger105 } from "@bondr/core/math";
import { redact } from "@bondr/core/net";
import { BN } from "@bondr/core/pump";
import type { TransactionInstruction } from "@solana/web3.js";
import { finalizeJob } from "./fee-finalize.ts";
import { guard, spend } from "./fee-guard.ts";
import type { NewEntry } from "./fee-ledger.ts";
import { collectJob, settled, wBondr, worthCollecting } from "./fee-prebond.ts";
import { type FeeCoin, type FeeDeps, factsFor, type Landed } from "./fee-send.ts";
import { mark } from "./health.ts";

const BOND_KINDS: LedgerKind[] = ["forced_bond", "pool_burn"];
const CU = 600_000;
const DONE: Landed = { state: "done" };
const SKIPPED: Landed = { state: "skipped" }; // D-19: settled() stops at it, so bondedJob never reaches finalize
const big = (x: BN): bigint => BigInt(x.toString());

// The row's amount is the intent (W's whole balance); the landed amount is what W actually spent.
function burnLand(d: FeeDeps, coin: FeeCoin, row: NewEntry, ixs: TransactionInstruction[]): Promise<Landed> {
  const w = coin.w.publicKey;
  coin.open = true;
  return d.land({
    ...{ rows: [row], ixs, signers: [coin.w], urgent: true, sender: true, cu: CU },
    facts: (meta) => factsFor([row], meta, d.Q, w),
  });
}

// D-15: the trigger came from indexed reserves, so the cost is read fresh here and forcedBondIxs simulates.
// A cost of 0 means the curve already completed: the migration event runs bondedJob instead.
async function forcedSend(d: FeeDeps, coin: FeeCoin): Promise<Landed> {
  const [mint, w] = [coin.mint.toBase58(), coin.w.publicKey];
  const cost = big(await costToComplete(d.online, coin.mint));
  const balance = await wBondr(d, coin);
  if (cost === 0n || !trigger105(balance, cost)) {
    console.log(`forced bond not ready ${mint}: budget ${balance}, cost ${cost}`);
    coin.notReady = { budget: budgetOf(coin.feeBudget, coin.feesUnclaimed), cost: coin.cost ?? cost };
    return DONE;
  }
  const { ixs, burnAmount } = await forcedBondIxs({
    ...{ conn: d.conn, global: await d.online.fetchGlobal(), ops: d.ops.publicKey, w },
    ...{ mint: coin.mint, quoteMint: d.Q, budget: new BN(balance.toString()) },
    wFloatLamports: await wFloat(d.conn, w),
  });
  return burnLand(d, coin, { kind: "forced_bond", mint, amount: balance, burned: big(burnAmount) }, ixs);
}

// D-15 on memory: the budget clears 105% of the cost and, after a chain "not ready" verdict, memory has moved
// by at least 1% since (WR-06), so a coin at the boundary does not rerun an urgent collect on every trade.
export function forceDue(coin: FeeCoin, cost: bigint): boolean {
  const [budget, n] = [budgetOf(coin.feeBudget, coin.feesUnclaimed), coin.notReady];
  if (!trigger105(budget, cost)) return false;
  return !n || budget * 100n >= n.budget * 101n || cost * 100n <= n.cost * 99n;
}

// The urgent collect only when worth its fee (D-11): the forced bond can retrigger on every curve trade, so a
// paused one returns before any read.
export async function forcedJob(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  if (d.allowed && !d.allowed("forcedBond", coin)) return [SKIPPED];
  if (!d.sim) mark("bondCheck");
  if (await d.ledger.has(coin.mint.toBase58(), BOND_KINDS)) return [DONE];
  const out = worthCollecting(d, coin) ? [await collectJob(d, coin, true)] : [];
  return spend(d, coin, out, () => forcedSend(d, coin), true);
}

type PoolIxs = { ixs: TransactionInstruction[]; burnAmount: BN; path: "exact_quote_in" | "buy_v2" };

// A2: exact-quote-in spends the whole budget. If it fails simulation, the proven buy_v2 of what 95% of the
// budget buys runs instead, and the closing sweep takes what it leaves.
async function poolIxs(d: FeeDeps, coin: FeeCoin, balance: bigint): Promise<PoolIxs> {
  const w = coin.w.publicKey;
  const o = { connAmm: d.amm, ops: d.ops.publicKey, w, mint: coin.mint, quoteMint: d.Q };
  const [budget, wFloatLamports] = [new BN(balance.toString()), await wFloat(d.conn, w)];
  try {
    return {
      ...(await poolExactInBurnIxs({ ...o, conn: d.conn, budget, wFloatLamports })),
      path: "exact_quote_in",
    };
  } catch (e) {
    const why = redact(e instanceof Error ? e.message : String(e));
    console.warn(`pool burn exact-quote-in failed, using buy_v2: ${why}`);
    const quote = new BN(applyBps(balance, 9500).toString());
    const baseOut = await poolBaseOut({ amm: d.amm, w, mint: coin.mint, quoteMint: d.Q, quote });
    const ixs = await poolBuyBurnIxs({ ...o, baseOut, maxQuoteIn: budget, wFloatLamports });
    return { ixs, burnAmount: baseOut, path: "buy_v2" };
  }
}

export async function poolBurnJob(d: FeeDeps, coin: FeeCoin): Promise<Landed> {
  if (d.allowed && !d.allowed("forcedBond", coin)) return SKIPPED;
  const balance = await wBondr(d, coin);
  if (balance === 0n) return DONE;
  const { ixs, burnAmount, path } = await poolIxs(d, coin, balance);
  const mint = coin.mint.toBase58();
  const row: NewEntry = {
    kind: "pool_burn",
    mint,
    amount: balance,
    burned: big(burnAmount),
    detail: { path },
  };
  return burnLand(d, coin, row, ixs);
}

// FEE-03 on the migration event (Pitfall 6: venue pool, never complete), then finalize (D-18) once the bond's
// burn, forced or on the pool, has landed. A pending one is settled from chain first and finalize waits while it
// stays pending (WR-02): a dropped pool burn must be sent again, never closing-swept 90/10. With a burn already
// there, collect and split are left to finalize's closing collect: a collect sweeping the curve as W fails once
// the sharing config exists, and a restart between the two finalize txs must still resume.
export async function bondedJob(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  const out = await guard(d, coin, true);
  if (!out.every(settled)) return out;
  if (!(await d.ledger.has(coin.mint.toBase58(), BOND_KINDS))) {
    // The urgent collect only feeds the pool burn, so the forced bond switch pauses it too (T-06-07-01).
    if (d.allowed && !d.allowed("forcedBond", coin)) return [...out, SKIPPED];
    out.push(...(await spend(d, coin, [await collectJob(d, coin, true)], () => poolBurnJob(d, coin), true)));
    if (!out.every(settled)) return out;
  }
  out.push(...(await finalizeJob(d, coin)));
  return out;
}
