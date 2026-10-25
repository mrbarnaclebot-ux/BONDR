// Pre-bond fee jobs (FEE-01, FEE-04): collect, the 90/10 split and the window sweep, each one tx through
// d.land. Ops pays every fee; W signs only the split and the sweep (D-02).
import { collectIxs, splitIxs, sweepIxs } from "@bondr/core/collect";
import { sweepSplit } from "@bondr/core/fees";
import { split90_10 } from "@bondr/core/math";
import { toSol } from "@bondr/core/price";
import { tokenDelta } from "@bondr/core/trade";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { feeConfig } from "./fee-config.ts";
import type { Entry, NewEntry } from "./fee-ledger.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

const DECIMALS = 6; // BONDR, the quote mint (price.ts)
const DONE: Landed = { state: "done" };

// Permissionless, so W does not sign. The amount is W's BONDR delta in this tx's own meta (D-14).
export async function collectJob(d: FeeDeps, coin: FeeCoin, urgent = false): Promise<Landed> {
  const [mint, W] = [coin.mint, coin.w.publicKey];
  const ixs = await collectIxs({
    online: d.online,
    payer: d.ops.publicKey,
    mint,
    creator: W,
    quoteMint: d.Q,
  });
  return d.land({
    rows: [{ kind: "collect", mint: mint.toBase58() }],
    ixs,
    signers: [],
    urgent,
    facts: (meta) => ({ collect: { amount: tokenDelta(meta, d.Q, W) } }),
  });
}

// Sized from the collect row's amount, never from W's balance (D-14, T-05-04-03).
export async function splitJob(d: FeeDeps, coin: FeeCoin, collect: Entry, urgent = false): Promise<Landed> {
  const amount = split90_10(collect.amount ?? 0n).treasury;
  if (amount === 0n) return DONE;
  const ixs = splitIxs({
    ...{ payer: d.ops.publicKey, creator: coin.w.publicKey, treasury: d.treasury, quoteMint: d.Q },
    ...{ treasuryAmount: amount, decimals: DECIMALS },
  });
  const row: NewEntry = { kind: "split_treasury", mint: coin.mint.toBase58(), ref: collect.id, amount };
  return d.land({ rows: [row], ixs, signers: [coin.w], urgent });
}

// W's BONDR balance: a missing ATA is 0; any other RPC error throws, so a flaky read never skips a sweep silently.
export async function wBondr(d: FeeDeps, coin: FeeCoin): Promise<bigint> {
  const ata = getAssociatedTokenAddressSync(d.Q, coin.w.publicKey, true, T22);
  try {
    return BigInt((await d.conn.getTokenAccountBalance(ata)).value.amount);
  } catch (e) {
    if (e instanceof Error && /could not find account/i.test(e.message)) return 0n;
    throw e;
  }
}

// D-12: after the split, all of W's BONDR is budget; it leaves 90/10 in one W-signed tx. Zero writes no row.
export async function sweepJob(d: FeeDeps, coin: FeeCoin, windowIndex: number): Promise<Landed> {
  const balance = await wBondr(d, coin);
  if (balance === 0n) return DONE;
  const { buyback, treasury } = sweepSplit(balance);
  const mint = coin.mint.toBase58();
  const rows: NewEntry[] = [
    { kind: "sweep_buyback" as const, mint, amount: buyback, windowIndex },
    { kind: "sweep_treasury" as const, mint, amount: treasury, windowIndex },
  ].filter((r) => r.amount > 0n);
  const ixs = sweepIxs({
    ...{ payer: d.ops.publicKey, w: coin.w.publicKey, buyback: d.buyback.publicKey, treasury: d.treasury },
    ...{ quoteMint: d.Q, buybackAmount: buyback, treasuryAmount: treasury, decimals: DECIMALS },
  });
  return d.land({ rows, ixs, signers: [coin.w] });
}

// D-11: collect only when the bucket is worth an ops fee; with no BONDR price yet, any fees are.
function worthCollecting(d: FeeDeps, coin: FeeCoin): boolean {
  if (coin.feesUnclaimed <= 0n) return false;
  const price = d.bondrSol();
  return price === null || toSol(coin.feesUnclaimed, price) >= BigInt(feeConfig(d.net).collectMinLamports);
}

export const settled = (r: Landed) => r.state === "landed" || r.state === "done" || r.state === "dry";

// Window end (D-10, D-12): collect, split every open collect of this coin, then sweep. The sweep waits for a
// later window while any step is unsettled, so a treasury tenth is never swept 90/10 by mistake.
export async function windowJob(d: FeeDeps, coin: FeeCoin, index: number): Promise<Landed[]> {
  const mint = coin.mint.toBase58();
  const out: Landed[] = [];
  if (worthCollecting(d, coin)) out.push(await collectJob(d, coin));
  for (const c of (await d.ledger.openCollects()).filter((e) => e.mint === mint))
    out.push(await splitJob(d, coin, c));
  if (!out.every(settled)) return out;
  out.push(await sweepJob(d, coin, index));
  return out;
}
