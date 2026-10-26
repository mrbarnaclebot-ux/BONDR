// FEE-05 and FEE-07 on the fork through the worker's own fee-finalize.ts and fee-batch.ts, on E2 (traders bonded,
// pool-burned by engine-bond.ts). Two sim PumpSwap trades accrue post-bond creator fees, then finalizeJob runs the
// deployer pre-flight on E2's real launch tx, the config tx, the one 8000/2000 update and the closing sweep. Two
// more trades accrue fees to the sharing config, and distributeJob pays them out. Devnet cannot prove this (D-06:
// no child bonds there).
import { poolBaseOut } from "@bondr/core/bond";
import { applyBps } from "@bondr/core/math";
import { BN, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { FINAL_SHARES, readSharing } from "@bondr/core/sharing";
import { poolBuy, poolSell } from "@bondr/core/trade";
import { PublicKey } from "@solana/web3.js";
import { distributeJob } from "../../../apps/worker/src/fee-batch.ts";
import { finalizeJob } from "../../../apps/worker/src/fee-finalize.ts";
import type { FeeCoin } from "../../../apps/worker/src/fee-send.ts";
import type { Rule, Stage } from "../results.ts";
import { land, newRun, sigOk, topUp } from "./bond.ts";
import { type E, feeDeps, pick, record } from "./engine-bond.ts";
import { tokenAmount } from "./launch.ts";
import { updateRule } from "./sharing.ts";

export type F = E & { coin: FeeCoin };

// A buy of a tenth of the trader's Q (an empty trader gets a whale top-up first), then a sell of all of it.
// Both pay the pool creator fee: to W before finalize, to the sharing config after it.
export async function trades(f: F, tag: string): Promise<void> {
  const trader = f.ctx.key("sim", "trader");
  const o = {
    amm: new OnlinePumpAmmSdk(f.ctx.conn),
    mint: f.coin.mint,
    quoteMint: f.Q,
    user: trader.publicKey,
  };
  if ((await tokenAmount(f.ctx, f.Q, o.user)) === "0") {
    const amount = new BN(await tokenAmount(f.ctx, f.Q, f.whale.publicKey)).divn(100);
    await topUp(f, `aux.engine.${tag}.trader.topup`, o.user, amount, {});
  }
  const quote = BigInt(await tokenAmount(f.ctx, f.Q, o.user)) / 10n;
  const baseOut = await poolBaseOut({ ...o, w: o.user, quote: new BN(applyBps(quote, 9500).toString()) });
  const buy = await poolBuy({ ...o, baseOut, maxQuoteIn: new BN(quote.toString()) });
  const step = "Sim trader PumpSwap buy_v2 on E2's pool (post-bond creator fees accrue)";
  await land(f, { id: `aux.engine.${tag}.buy`, step, payer: trader, ixs: buy }, async () => ({}));
  const baseIn = new BN(await tokenAmount(f.ctx, f.coin.mint, o.user));
  const sell = await poolSell({ ...o, baseIn, minQuoteOut: new BN(1) });
  const sellStep = "Sim trader PumpSwap sell_v2 of all of it on E2's pool";
  await land(f, { id: `aux.engine.${tag}.sell`, step: sellStep, payer: trader, ixs: sell }, async () => ({}));
}

// The decoded SharingConfig after the update is the row's proof, not the send result (as finalize.ts).
export async function shares(f: F) {
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

// The fork deps carry no BONDR price, so any pending fees clear the minimum (the null-price rule, as a collect).
async function distribute(f: F): Promise<void> {
  const out = await distributeJob(f.d, f.coin);
  const detail = (out.rows?.[0]?.detail ?? {}) as Record<string, string>;
  const step = "Engine distributeJob: sweeps, transfer_creator_fees_to_pump_v2, distribute_creator_fees_v2";
  record(f, "engine.distribute", step, out, {
    ...{ deployerAmount: detail.deployerAmount ?? "-1", treasuryAmount: detail.treasuryAmount ?? "-1" },
  });
}

// 80:20 by finalize.distribute's rule: both above 0, and the deployer's floor share within 1 base unit.
export const distributeRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  const [d, t] = [BigInt(f.deployerAmount ?? -1), BigInt(f.treasuryAmount ?? -1)];
  if (d <= 0n || t <= 0n) return `amounts ${d} / ${t}, both must be above 0`;
  const want = ((d + t) * BigInt(FINAL_SHARES.deployer)) / 10000n;
  const off = d > want ? d - want : want - d;
  return off <= 1n ? null : `deployer got ${d}, 80% of ${d + t} is ${want}`;
};

const emptyRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  return f.wBondrAfter === "0" && f.wChildAfter === "0"
    ? null
    : `W holds ${f.wBondrAfter} BONDR, ${f.wChildAfter} child`;
};

// devKey: the state entry holding the coin's recorded deployer (E2.dev here, AD.dev in admin.ts).
export const finalUpdateRule =
  (devKey: string): Rule =>
  (row, file) => {
    if (row.facts?.holders !== `${file.state[devKey]},${row.facts?.treasury}`)
      return `deployer is not ${devKey}`;
    if (row.facts?.shares !== `${FINAL_SHARES.deployer},${FINAL_SHARES.treasury}`) return "not 8000/2000";
    return updateRule(row, file);
  };

export const engineFinalStage: Stage = {
  name: "engine-final",
  rules: () => ({
    "engine.finalize.config": sigOk,
    "engine.finalize.update": finalUpdateRule("E2.dev"),
    "engine.finalize.sweep": emptyRule,
    "engine.distribute": distributeRule,
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
    await trades(f, "final");
    await finalize(f);
    await trades(f, "distribute");
    await distribute(f);
  },
};
