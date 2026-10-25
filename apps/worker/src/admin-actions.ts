// The recovery action registry (ADMIN-03, D-15, D-16, RESEARCH Pattern 4): each transaction action is an
// existing engine path with the state it applies in, the destinations its funds may reach and the accounts its
// preview shows. The same run executes twice: captured (admin-sim.ts) to simulate, gated (06-13) to send. Both
// deps allow every job, so admin runs ignore kill switches and holds (D-16).
import type { AdminTxAction } from "@bondr/core/api-admin";
import { migrateIxs } from "@bondr/core/bond";
import { costToComplete } from "@bondr/core/curve";
import { budgetOf, windowOf } from "@bondr/core/fees";
import { trigger105 } from "@bondr/core/math";
import { feeSharingConfigPda } from "@bondr/core/pump";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { AccountInfo, PublicKey } from "@solana/web3.js";
import { type Allowed, allowFor, short } from "./admin-dest.ts";
import { leftoverBurnJob, sweepLeftoversJob } from "./admin-leftover.ts";
import type { Watched } from "./admin-sim.ts";
import { buybackBurnJob, distributeJob } from "./fee-batch.ts";
import { loadCoin } from "./fee-boot.ts";
import { forcedJob } from "./fee-burns.ts";
import type { Engine } from "./fee-engine.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { windowJob } from "./fee-guard.ts";
import type { Entry } from "./fee-ledger.ts";
import { settleRows } from "./fee-recover.ts";
import type { FeeCoin, FeeDeps, Landed } from "./fee-send.ts";

// One chain read and two ledger reads per view; the coin is the engine's own object (copy it to simulate).
export type ActionView = {
  coin: FeeCoin | null;
  mint: string | null;
  wChild: bigint;
  buybackBondr: bigint;
  costNow: bigint | null; // the fresh cost to complete, curve coins only
  failedSweep: { windowIndex: number } | null;
  pendingSweeps: Entry[];
};
export type ActionDef = {
  applies(v: ActionView): string | null; // null, or the reason code the UI maps to copy
  allow(v: ActionView, d: FeeDeps): Allowed;
  watch(v: ActionView, d: FeeDeps): Watched;
  run(d: FeeDeps, v: ActionView): Promise<Landed[]>;
};
type Watch = Watched[number];
type Dest = Partial<Pick<Parameters<typeof allowFor>[0], "treasury" | "buyback" | "deployer">>;

const SWEEPS = ["sweep_buyback", "sweep_treasury"] as const;
const MIGRATE_CU = 600_000; // 342,473 used on the fork (bond.migrate)
const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);
const units = (a: AccountInfo<Buffer> | null | undefined) => (a ? AccountLayout.decode(a.data).amount : 0n);

// applies() runs first, so run and watch only ever see a view that has its coin.
function need(v: ActionView): FeeCoin {
  if (!v.coin) throw new Error("recovery action needs a coin");
  return v.coin;
}
const on = (ok: (c: FeeCoin, v: ActionView) => boolean, reason: string) => (v: ActionView) =>
  v.coin && ok(v.coin, v) ? null : reason;

// Every list holds the coin's own W for internal moves (the ops float, its own ATAs); closes go to the treasury.
function allowed(v: ActionView, d: FeeDeps, dest: Dest = {}): Allowed {
  const c = v.coin;
  const coinSide = c ? { internal: [c.w.publicKey], mints: [d.Q, c.mint] } : { internal: [], mints: [d.Q] };
  return allowFor({ ...dest, ...coinSide, closeTo: d.treasury });
}
const sweepDest = (v: ActionView, d: FeeDeps) =>
  allowed(v, d, { treasury: d.treasury, buyback: d.buyback.publicKey });

const sol = (address: PublicKey, name: string): Watch => ({ address, name, kind: "sol", unit: "SOL" });
const bondr = (d: FeeDeps, owner: PublicKey, name: string): Watch => ({
  ...{ address: ataOf(d.Q, owner), name, kind: "token", unit: "BONDR" },
});
const ops = (d: FeeDeps) => sol(d.ops.publicKey, "Ops wallet");
const wName = (c: FeeCoin) => `W ${short(c.w.publicKey)}`;
const wBondr = (d: FeeDeps, v: ActionView) => bondr(d, need(v).w.publicKey, wName(need(v)));
const wChild = (v: ActionView): Watch => {
  const c = need(v);
  return { address: ataOf(c.mint, c.w.publicKey), name: wName(c), kind: "token", unit: "tokens" };
};
const treasury = (d: FeeDeps) => bondr(d, d.treasury, "Treasury");
const buyback = (d: FeeDeps) => bondr(d, d.buyback.publicKey, "Buyback");
const deployer = (d: FeeDeps, c: FeeCoin) => bondr(d, c.wallet, `Deployer ${short(c.wallet)}`);
const sweepWatch = (v: ActionView, d: FeeDeps) => [ops(d), wBondr(d, v), treasury(d), buyback(d)];

const sweepNow: ActionDef = {
  applies: on((c) => c.venue === "curve", "not_curve"),
  allow: sweepDest,
  watch: sweepWatch,
  // A9, Pitfall 7: it is the current window's sweep, early; the window's own timer then finds it done.
  run: (d, v) => {
    const c = need(v);
    c.open = true; // an owner run: the guard reads Postgres even for a coin idle since boot
    return windowJob(d, c, windowOf(c.launchedAt, Date.now(), d.windowMs));
  },
};

const retrySweep: ActionDef = {
  applies: (v) => (v.coin && v.failedSweep ? null : "no_failed_sweep"),
  allow: sweepDest,
  watch: sweepWatch,
  // A failed row is not live, so its window index is free again. A simulation settles nothing (dry writes nothing).
  run: async (d, v) => {
    const c = need(v);
    if (d.mode === "on" && v.pendingSweeps.length) await settleRows(d, v.pendingSweeps, () => c);
    c.open = true;
    return windowJob(d, c, v.failedSweep?.windowIndex ?? 0);
  },
};

const retryForcedBond: ActionDef = {
  applies: on(
    (c, v) =>
      c.venue === "curve" && !!v.costNow && trigger105(budgetOf(c.feeBudget, c.feesUnclaimed), v.costNow),
    "below_trigger",
  ),
  allow: (v, d) => allowed(v, d, { treasury: d.treasury }), // the split before the burn
  watch: (v, d) => [ops(d), wBondr(d, v), treasury(d)],
  run: (d, v) => forcedJob(d, need(v)),
};

const burnWTokens: ActionDef = {
  applies: (v) => (v.coin && v.wChild > 0n ? null : "no_child"),
  allow: (v, d) => allowed(v, d),
  watch: (v, d) => [ops(d), wChild(v)],
  run: async (d, v) => [await leftoverBurnJob(d, need(v))],
};

// Permissionless migrate_v2 with ops as the user; no ledger row (the admin audit records it).
const runMigrate: ActionDef = {
  applies: on((c) => c.venue === "complete", "not_complete"),
  allow: (v, d) => allowed(v, d),
  watch: (_v, d) => [ops(d)],
  run: async (d, v) => {
    const c = need(v);
    const global = await d.online.fetchGlobal();
    const ixs = await migrateIxs({ global, user: d.ops.publicKey, mint: c.mint, quoteMint: d.Q });
    return [await d.land({ rows: [], ixs, signers: [], cu: MIGRATE_CU })];
  },
};

// D-15: the deployer is always the coin's recorded launch wallet, never a typed address. The buyback is listed
// because finalize's closing sweep sends the post-bond fees 90/10 like any window (A6, 2026-10-25).
const finalizeSplit: ActionDef = {
  applies: on((c) => c.venue === "pool" && c.finalize !== "done", "not_bonded"),
  allow: (v, d) =>
    allowed(v, d, { treasury: d.treasury, buyback: d.buyback.publicKey, deployer: need(v).wallet }),
  watch: (v, d) => {
    const c = need(v);
    const config = sol(feeSharingConfigPda(c.mint), "Fee sharing config");
    return [
      ops(d),
      sol(c.w.publicKey, wName(c)),
      wBondr(d, v),
      treasury(d),
      buyback(d),
      deployer(d, c),
      config,
    ];
  },
  run: (d, v) => {
    const coin = need(v);
    return finalizeJob(d, coin, coin.wallet);
  },
};

const finalized = (c: FeeCoin) => c.finalize === "done";

// The program pays the holders finalize locked; the engine names no recipient.
const distributeNow: ActionDef = {
  applies: on(finalized, "not_finalized"),
  allow: (v, d) => allowed(v, d),
  watch: (v, d) => [ops(d), deployer(d, need(v)), treasury(d)],
  run: async (d, v) => [await distributeJob(d, need(v), { anyAmount: true })],
};

const sweepLeftovers: ActionDef = {
  applies: on(finalized, "not_finalized"),
  allow: sweepDest,
  watch: (v, d) => [...sweepWatch(v, d), wChild(v), sol(d.treasury, "Treasury")],
  run: (d, v) => sweepLeftoversJob(d, need(v)),
};

const burnBuyback: ActionDef = {
  applies: (v) => (v.buybackBondr > 0n ? null : "no_bondr"),
  allow: (v, d) => allowed(v, d),
  watch: (_v, d) => [ops(d), buyback(d)],
  run: async (d) => [await buybackBurnJob(d)],
};

export const ACTIONS: Record<Exclude<AdminTxAction, "evacuate">, ActionDef> = {
  sweep_now: sweepNow,
  retry_forced_bond: retryForcedBond,
  burn_w_tokens: burnWTokens,
  run_migrate: runMigrate,
  finalize_split: finalizeSplit,
  retry_sweep: retrySweep,
  distribute_now: distributeNow,
  sweep_leftovers: sweepLeftovers,
  burn_buyback: burnBuyback,
};

// The engine's coin, or one row from the database with the engine off (A1). A missing coin stays null: the
// route answers not_found before applies() runs.
export async function actionView(
  d: FeeDeps,
  mint: string | null,
  engine: Pick<Engine, "coin"> | null,
  load: (mint: string) => Promise<FeeCoin | undefined> = loadCoin,
): Promise<ActionView> {
  const coin = (mint ? (engine ? engine.coin(mint) : await load(mint)) : undefined) ?? null;
  const keys = [ataOf(d.Q, d.buyback.publicKey), ...(coin ? [ataOf(coin.mint, coin.w.publicKey)] : [])];
  const [infos, cost, failed, pendingSweeps] = await Promise.all([
    d.conn.getMultipleAccountsInfo(keys),
    coin?.venue === "curve" ? costToComplete(d.online, coin.mint) : null,
    coin ? d.ledger.failedSweep(coin.mint.toBase58()) : null,
    coin ? d.ledger.pendingFor(coin.mint.toBase58(), [...SWEEPS]) : [],
  ]);
  const windowIndex = failed?.windowIndex;
  return {
    ...{ coin, mint, buybackBondr: units(infos[0]), wChild: units(infos[1]) },
    costNow: cost === null ? null : BigInt(cost.toString()),
    failedSweep: windowIndex === undefined ? null : { windowIndex },
    pendingSweeps,
  };
}

// Pitfall 9: on the coin's queue (burn_buyback's is "platform") so an admin run never overlaps the coin's
// automatic jobs; with FEE_ENGINE off there is no queue and fn runs directly.
export function runOn<T>(
  engine: Pick<Engine, "exclusive"> | null,
  mint: string | null,
  fn: () => Promise<T>,
) {
  return engine ? engine.exclusive(mint ?? "platform", fn) : fn();
}
