// FEE-05 on the fork through the worker's own fee-finalize.ts, on E2 (traders bonded, pool-burned by
// engine-bond.ts). Two sim PumpSwap trades accrue post-bond creator fees, then finalizeJob runs the deployer
// pre-flight on E2's real launch tx, the config tx, the one 8000/2000 update and the closing sweep. Devnet cannot
// prove this (D-06: no child bonds there).
import { poolBaseOut } from "@bondr/core/bond";
import { applyBps } from "@bondr/core/math";
import { BN, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { FINAL_SHARES, readSharing } from "@bondr/core/sharing";
import { poolBuy, poolSell } from "@bondr/core/trade";
import { PublicKey } from "@solana/web3.js";
import { finalizeJob } from "../../../apps/worker/src/fee-finalize.ts";
import type { FeeCoin } from "../../../apps/worker/src/fee-send.ts";
import type { Rule, Stage } from "../results.ts";
import { land, newRun, sigOk, topUp } from "./bond.ts";
import { type E, feeDeps, pick, record } from "./engine-bond.ts";
import { tokenAmount } from "./launch.ts";
import { updateRule } from "./sharing.ts";

type F = E & { coin: FeeCoin };

// A buy of a tenth of the trader's Q (an empty trader gets a whale top-up first), then a sell of all of it.
// Both pay the pool creator fee to W, so the update's inner distribution has something to pay.
async function trades(f: F): Promise<void> {
  const trader = f.ctx.key("sim", "trader");
  const o = {
    amm: new OnlinePumpAmmSdk(f.ctx.conn),
    mint: f.coin.mint,
    quoteMint: f.Q,
    user: trader.publicKey,
  };
  if ((await tokenAmount(f.ctx, f.Q, o.user)) === "0") {
    const amount = new BN(await tokenAmount(f.ctx, f.Q, f.whale.publicKey)).divn(100);
    await topUp(f, "aux.engine.final.trader.topup", o.user, amount, {});
  }
  const quote = BigInt(await tokenAmount(f.ctx, f.Q, o.user)) / 10n;
  const baseOut = await poolBaseOut({ ...o, w: o.user, quote: new BN(applyBps(quote, 9500).toString()) });
  const buy = await poolBuy({ ...o, baseOut, maxQuoteIn: new BN(quote.toString()) });
  const step = "Sim trader PumpSwap buy_v2 on E2's pool (post-bond creator fees accrue)";
  await land(f, { id: "aux.engine.final.buy", step, payer: trader, ixs: buy }, async () => ({}));
  const baseIn = new BN(await tokenAmount(f.ctx, f.coin.mint, o.user));
  const sell = await poolSell({ ...o, baseIn, minQuoteOut: new BN(1) });
  const sellStep = "Sim trader PumpSwap sell_v2 of all of it on E2's pool";
  await land(f, { id: "aux.engine.final.sell", step: sellStep, payer: trader, ixs: sell }, async () => ({}));
}

// The decoded SharingConfig after the update is the row's proof, not the send result (as finalize.ts).
async function shares(f: F) {
  const s = await readSharing(f.ctx.conn, f.coin.mint);
  return {
    ...{ deployer: f.coin.wallet.toBase58(), treasury: f.d.treasury.toBase58() },
    ...{ shares: s.shares.join(","), holders: s.holders.join(","), adminRevoked: s.adminRevoked },
  };
}

async function finalize(f: F): Promise<void> {
  const out = await finalizeJob(f.d, f.coin);
  const w = f.coin.w.publicKey;
  const config =
    "Engine finalizeJob: deployer pre-flight on E2's launch tx, sweeps + create_fee_sharing_config";
  record(f, "engine.finalize.config", config, pick(out, "finalize_config"));
  const update = "Engine finalizeJob: pool sweep + the one update_fee_shares_v2 to 8000 / 2000";
  record(f, "engine.finalize.update", update, pick(out, "finalize_update"), await shares(f));
  // The closing collect empties W's own vaults (tx1's pool sweep parked the post-bond fees there), then the
  // window split and this sweep.
  const sweep = "Engine closing collect + split + sweep: W's post-bond BONDR 90/10 to buyback and treasury";
  const amount = (kind: string) => String(pick(out, kind)?.rows?.[0]?.amount ?? -1);
  record(f, "engine.finalize.sweep", sweep, pick(out, "sweep_buyback"), {
    ...{ closingCollect: amount("collect"), closingSplit: amount("split_treasury") },
    wBondrAfter: await tokenAmount(f.ctx, f.Q, w),
    wChildAfter: await tokenAmount(f.ctx, f.coin.mint, w),
  });
}

const emptyRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  return f.wBondrAfter === "0" && f.wChildAfter === "0"
    ? null
    : `W holds ${f.wBondrAfter} BONDR, ${f.wChildAfter} child`;
};

const finalUpdateRule: Rule = (row, file) => {
  if (row.facts?.holders !== `${file.state["E2.dev"]},${row.facts?.treasury}`)
    return "deployer is not E2's dev";
  if (row.facts?.shares !== `${FINAL_SHARES.deployer},${FINAL_SHARES.treasury}`) return "not 8000/2000";
  return updateRule(row, file);
};

export const engineFinalStage: Stage = {
  name: "engine-final",
  rules: () => ({
    "engine.finalize.config": sigOk,
    "engine.finalize.update": finalUpdateRule,
    "engine.finalize.sweep": emptyRule,
  }),
  async run(ctx) {
    const s = ctx.file.state;
    if (!s.E2 || !s["E2.sig"] || !s["E2.dev"]) throw new Error("no E2 in state: run the engine stage first");
    const run = await newRun(ctx);
    const mint = new PublicKey(s.E2);
    const coin: FeeCoin = {
      ...{
        mint,
        w: ctx.key("w", s.E2),
        launchedAt: Date.now(),
        venue: "pool",
        feesUnclaimed: 0n,
        feeBudget: 0n,
      },
      ...{ cost: null, launchSig: s["E2.sig"], wallet: new PublicKey(s["E2.dev"]), finalize: "none" },
    };
    const f: F = { ...run, d: feeDeps(run), coin };
    await trades(f);
    await finalize(f);
  },
};
