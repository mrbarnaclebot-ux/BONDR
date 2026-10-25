// The two bond burns (FEE-02, FEE-03): the forced bond when W's budget reaches 105% of the cost to complete
// (D-15), and the PumpSwap burn of W's whole budget when traders bonded first (D-17). Both are urgent, so they
// run below the ops floor (D-20), and set sender, which only takes effect on mainnet (D-16). After a forced
// bond lands, pump's keeper migrates the coin on devnet and mainnet; the fork stage migrates it itself.
import type { LedgerKind } from "@bondr/core/api";
import { forcedBondIxs, poolBaseOut, poolBuyBurnIxs, poolExactInBurnIxs } from "@bondr/core/bond";
import { costToComplete } from "@bondr/core/curve";
import { wFloat } from "@bondr/core/float";
import { applyBps, trigger105 } from "@bondr/core/math";
import { redact } from "@bondr/core/net";
import { BN } from "@bondr/core/pump";
import { tokenDelta } from "@bondr/core/trade";
import type { TransactionInstruction } from "@solana/web3.js";
import { finalizeJob } from "./fee-finalize.ts";
import type { NewEntry } from "./fee-ledger.ts";
import { collectJob, settled, splitJob, wBondr } from "./fee-prebond.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

const BOND_KINDS: LedgerKind[] = ["forced_bond", "pool_burn"];
const CU = 600_000;
const DONE: Landed = { state: "done" };
const big = (x: BN): bigint => BigInt(x.toString());

// Urgent collect, then the split of every open collect of this coin, so W's BONDR is all burn budget.
async function collectSplit(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  const mint = coin.mint.toBase58();
  const out = [await collectJob(d, coin, true)];
  for (const c of (await d.ledger.openCollects()).filter((e) => e.mint === mint))
    out.push(await splitJob(d, coin, c, true));
  return out;
}

// The row's amount is the intent (W's whole balance); the landed amount is what W actually spent.
function burnLand(d: FeeDeps, coin: FeeCoin, row: NewEntry, ixs: TransactionInstruction[]): Promise<Landed> {
  const w = coin.w.publicKey;
  return d.land({
    ...{ rows: [row], ixs, signers: [coin.w], urgent: true, sender: true, cu: CU },
    facts: (meta) => ({ [row.kind]: { amount: -tokenDelta(meta, d.Q, w) } }),
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
    return DONE;
  }
  const { ixs, burnAmount } = await forcedBondIxs({
    ...{ conn: d.conn, global: await d.online.fetchGlobal(), ops: d.ops.publicKey, w },
    ...{ mint: coin.mint, quoteMint: d.Q, budget: new BN(balance.toString()) },
    wFloatLamports: await wFloat(d.conn, w),
  });
  return burnLand(d, coin, { kind: "forced_bond", mint, amount: balance, burned: big(burnAmount) }, ixs);
}

export async function forcedJob(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  if (await d.ledger.has(coin.mint.toBase58(), BOND_KINDS)) return [DONE];
  const out = await collectSplit(d, coin);
  if (!out.every(settled)) return out;
  out.push(await forcedSend(d, coin));
  return out;
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
// burn, forced or on the pool, is live. With a burn already there, collect and split are left to finalize's
// closing collect: a collect sweeping the curve as W fails once the sharing config exists, and a restart
// between the two finalize txs must still resume.
export async function bondedJob(d: FeeDeps, coin: FeeCoin): Promise<Landed[]> {
  const out: Landed[] = [];
  if (!(await d.ledger.has(coin.mint.toBase58(), BOND_KINDS))) {
    out.push(...(await collectSplit(d, coin)));
    if (out.every(settled)) out.push(await poolBurnJob(d, coin));
    if (!out.every(settled)) return out;
  }
  out.push(...(await finalizeJob(d, coin)));
  return out;
}
