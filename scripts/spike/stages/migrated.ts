// D-05 state 3 (fork): migrate_v2 moves the completed stand-in Q to its PumpSwap pool, then a child C3 is
// created on the migrated Q (its quote group gains the 3 pool accounts) and traded once. BONDR's own curve
// completes and migrates in production, so children must keep launching after it. The fork runs no keeper,
// so the spike calls migrate itself (D-03).
import { migrateIxs } from "@bondr/core/bond";
import { costToComplete } from "@bondr/core/curve";
import { buildCreate } from "@bondr/core/launch";
import { BN, canonicalPumpPoolPdaWithQuote } from "@bondr/core/pump";
import { buyExactIn } from "@bondr/core/trade";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { prefundMint } from "../fund.ts";
import type { Rule, Stage } from "../results.ts";
import { land, newRun, type Run } from "./bond.ts";
import { CHILD } from "./create.ts";
import { tokenAmount } from "./launch.ts";

const NOTES = "spike calls migrate itself; on mainnet pump's keeper migrates about 10 slots after completion";

async function migrateQ(run: Run): Promise<void> {
  const ixs = await migrateIxs({
    global: run.g,
    user: run.ops.publicKey,
    mint: run.Q,
    quoteMint: NATIVE_MINT,
  });
  const pool = canonicalPumpPoolPdaWithQuote(run.Q, NATIVE_MINT);
  const step = "migrate_v2 of the complete stand-in Q to its PumpSwap pool (ops signs)";
  const facts = async () => ({
    pool: pool.toBase58(),
    poolExists: !!(await run.ctx.conn.getAccountInfo(pool)),
  });
  await land(run, { id: "quote.migrate", step, payer: run.ops, ixs }, facts, { notes: NOTES });
}

async function createC3(run: Run): Promise<PublicKey> {
  const [mint, dev] = [Keypair.generate(), run.ctx.key("sim", "dev")];
  const W = run.ctx.key("w", mint.publicKey.toBase58()).publicKey;
  await prefundMint(run.ctx, mint.publicKey, dev);
  const pq = await run.online.fetchPumpQuote(run.Q, { global: run.g });
  if (!pq?.accounts.pool) throw new Error(`fetchPumpQuote gave no pool accounts for migrated Q ${run.Q}`);
  const ix = await buildCreate({
    ...CHILD,
    mint: mint.publicKey,
    creator: W,
    user: dev.publicKey,
    quoteMint: run.Q,
    pumpQuote: pq.accounts,
    creatorFeeBps: new BN(150),
  });
  const step = "Child C3 create_v2 on the migrated Q (quote group + 3 pool accounts, creator W3, 150 bps)";
  const tx = { id: "migrated.child.create", step, payer: dev, signers: [mint], ixs: [ix] };
  await land(run, tx, async ({ r }) => {
    const c = await run.online.fetchBondingCurve(mint.publicKey);
    return {
      mint: mint.publicKey.toBase58(),
      W: W.toBase58(),
      creator: c.creator.toBase58(),
      quoteMint: c.quoteMint.toBase58(),
      creatorFeeBps: c.creatorFeeBps.toString(),
      depth: c.depth,
      wireSize: r.bytes ?? 0,
      remainingAccounts: ix.keys.length - 16,
    };
  });
  run.ctx.file.state.C3 = mint.publicKey.toBase58();
  return mint.publicKey;
}

// 5% of C3's raise: a visible v3 buy with Q that stays far from completing C3 before the multihop stage.
async function tradeC3(run: Run, C3: PublicKey): Promise<void> {
  const trader = run.ctx.key("sim", "trader");
  const spend = (await costToComplete(run.online, C3)).divn(20);
  const have = new BN(await tokenAmount(run.ctx, run.Q, trader.publicKey));
  if (have.lt(spend)) throw new Error(`trader holds ${have} Q, the C3 buy needs ${spend}`);
  const side = { global: run.g, mint: C3, user: trader.publicKey, quoteMint: run.Q };
  const ixs = await buyExactIn({ ...side, spend, minOut: new BN(1) });
  const step = "Sim trader buy_exact_quote_in_v3 on C3 with Q";
  await land(run, { id: "migrated.trade", step, payer: trader, ixs }, async () => ({
    spend: spend.toString(),
    c3Out: await tokenAmount(run.ctx, C3, trader.publicKey),
  }));
}

const migrateRule: Rule = (row) =>
  !row.sig ? "no signature" : row.facts?.poolExists === true ? null : "Q pool missing after migrate";

const c3Rule: Rule = (row, file) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.creator !== f.W) return `creator ${f.creator} is not W3 ${f.W}`;
  if (f.quoteMint !== file.state.Q) return `quoteMint ${f.quoteMint} is not Q ${file.state.Q}`;
  return f.creatorFeeBps === "150" ? null : `creatorFeeBps ${f.creatorFeeBps}, expected 150`;
};

export const migratedStage: Stage = {
  name: "migrated",
  rules: () => ({
    "quote.migrate": migrateRule,
    "migrated.child.create": c3Rule,
    "migrated.trade": (row) => (row.sig ? null : "no signature"),
  }),
  async run(ctx) {
    const run = await newRun(ctx);
    await migrateQ(run);
    await tradeC3(run, await createC3(run));
  },
};
