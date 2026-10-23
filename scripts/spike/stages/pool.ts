// SPIKE-03 after the bond (fork): migrate_v2 moves the forced-bonded C2 to PumpSwap, then W2 buys an exact
// base amount on the pool and burns it in the same tx, the fallback when a coin bonded without the forced
// bond (PROJECT.md items 5 and 6). The fork runs no keeper, so the spike calls migrate itself (D-03).
import { migrateIxs, poolBaseOut, poolBuyBurnIxs } from "@bondr/core/bond";
import { applyBps } from "@bondr/core/math";
import { BN, canonicalPumpPoolPdaWithQuote, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { PACKET_LIMIT } from "@bondr/core/send";
import { type Keypair, PublicKey } from "@solana/web3.js";
import type { Rule, Stage } from "../results.ts";
import { burned, land, newRun, type Run, supply, topUp, topUpRule, wFloat } from "./bond.ts";
import { tokenAmount } from "./launch.ts";

const NOTES = "spike calls migrate itself; on mainnet the timing depends on pump's keeper (D-03)";

async function migrate(run: Run, mint: PublicKey): Promise<void> {
  const ixs = await migrateIxs({ global: run.g, user: run.ops.publicKey, mint, quoteMint: run.Q });
  const pool = canonicalPumpPoolPdaWithQuote(mint, run.Q);
  const step = "migrate_v2 of the forced-bonded C2 to its PumpSwap pool (ops signs)";
  const facts = async () => ({
    pool: pool.toBase58(),
    poolExists: !!(await run.ctx.conn.getAccountInfo(pool)),
  });
  await land(run, { id: "bond.migrate", step, payer: run.ops, ixs }, facts, { notes: NOTES });
}

// 1% of the whale's Q: enough for a visible pool buy, far below the pool's depth.
async function poolTopUp(run: Run, W: PublicKey): Promise<BN> {
  const amount = new BN(await tokenAmount(run.ctx, run.Q, run.whale.publicKey)).divn(100);
  await topUp(run, "bond.pool.topup", W, amount, {});
  return amount;
}

// baseOut is what 95% of the top-up buys after fees, so maxQuoteIn = the top-up always covers it.
async function poolBurn(run: Run, mint: PublicKey, W: Keypair, maxQuoteIn: BN): Promise<void> {
  const amm = new OnlinePumpAmmSdk(run.ctx.conn);
  const quote = new BN(applyBps(BigInt(maxQuoteIn.toString()), 9500).toString());
  const baseOut = await poolBaseOut({ amm, w: W.publicKey, mint, quoteMint: run.Q, quote });
  const [before, wFloatLamports] = [await supply(run, mint), await wFloat(run, W.publicKey)];
  const o = { connAmm: amm, ops: run.ops.publicKey, w: W.publicKey, mint, quoteMint: run.Q };
  const ixs = await poolBuyBurnIxs({ ...o, baseOut, maxQuoteIn, wFloatLamports });
  const step = "Pool buy + burn: W2 PumpSwap buy_v2 of exactly baseOut, BurnChecked(baseOut), one tx";
  await land(run, { id: "bond.pool.burn", step, payer: run.ops, signers: [W], ixs }, async () => ({
    baseOut: baseOut.toString(),
    maxQuoteIn: maxQuoteIn.toString(),
    supplyBefore: before,
    supplyAfter: await supply(run, mint),
    wChildAfter: await tokenAmount(run.ctx, mint, W.publicKey),
    wQAfter: await tokenAmount(run.ctx, run.Q, W.publicKey),
    wFloatLamports,
  }));
}

const migrateRule: Rule = (row) =>
  !row.sig ? "no signature" : row.facts?.poolExists === true ? null : "pool account missing after migrate";

const burnRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if ((row.bytes ?? Infinity) > PACKET_LIMIT) return `${row.bytes} bytes > ${PACKET_LIMIT}`;
  if (f.wChildAfter !== "0") return `W still holds ${f.wChildAfter} child tokens`;
  return burned(f) === BigInt(f.baseOut ?? -1) ? null : `supply dropped ${burned(f)}, baseOut ${f.baseOut}`;
};

export const poolStage: Stage = {
  name: "pool",
  rules: () => ({ "bond.migrate": migrateRule, "bond.pool.topup": topUpRule, "bond.pool.burn": burnRule }),
  async run(ctx) {
    if (!ctx.file.state.C2) throw new Error("no C2 in state: run the bond stage first");
    const run = await newRun(ctx);
    const C2 = new PublicKey(ctx.file.state.C2);
    const W = ctx.key("w", C2.toBase58());
    await migrate(run, C2);
    await poolBurn(run, C2, W, await poolTopUp(run, W.publicKey));
  },
};
