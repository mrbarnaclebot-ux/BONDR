// FEE-02 and FEE-03 on the fork through the worker's own fee-burns.ts, backed by a memoryLedger (D-06: devnet
// cannot bond a child). E1: a whale buy accrues creator fees, a TOP-UP lifts W to about 106% of the cost, then
// forcedJob collects, splits and force-bonds; bondedJob after the migration adds no pool burn. E2: the whale
// buys the whole curve, the stage migrates (the fork runs no keeper, Pitfall 6), then bondedJob collects,
// splits and burns W's whole budget on the pool.
import { migrateIxs } from "@bondr/core/bond";
import { costToComplete, readCurve } from "@bondr/core/curve";
import { BN, OnlinePumpAmmSdk } from "@bondr/core/pump";
import { buyExactIn } from "@bondr/core/trade";
import type { Keypair, PublicKey } from "@solana/web3.js";
import { bondedJob, forcedJob } from "../../../apps/worker/src/fee-burns.ts";
import { memoryLedger } from "../../../apps/worker/src/fee-ledger-memory.ts";
import {
  type FeeCoin,
  type FeeDeps,
  land as feeLand,
  type Landed,
} from "../../../apps/worker/src/fee-send.ts";
import type { Row, Rule, Stage } from "../results.ts";
import { burned, createChild, land, newRun, type Run, sigOk, supply, topUp } from "./bond.ts";
import { tokenAmount } from "./launch.ts";

export type E = Run & { d: FeeDeps };
type Facts = NonNullable<Row["facts"]>;

export function feeDeps(run: Run): FeeDeps {
  const d: FeeDeps = {
    ...{ net: "fork", mode: "on", conn: run.ctx.conn, online: run.online, Q: run.Q, ops: run.ops },
    windowMs: 60_000,
    amm: new OnlinePumpAmmSdk(run.ctx.conn),
    treasury: run.ctx.key("treasury", "main").publicKey,
    buyback: run.ctx.key("buyback", "main"),
    ledger: memoryLedger(),
    bondrSol: () => null,
    publish: () => {},
    land: (job) => feeLand(d, job),
  };
  return d;
}

// held: bondedJob's finalize waits here. engine-final.ts finalizes E2 after post-bond pool trades, so the
// update has fees to pay W.
const coinOf = (e: E, mint: PublicKey, w: Keypair, venue: FeeCoin["venue"]): FeeCoin => ({
  ...{ mint, w, launchedAt: Date.now(), venue, feesUnclaimed: 0n, feeBudget: 0n, cost: null },
  ...{ launchSig: "", wallet: e.ctx.key("sim", "dev").publicKey, finalize: "held" },
});

async function whaleBuy(e: E, id: string, mint: PublicKey, spend: BN, step: string): Promise<void> {
  const side = { global: e.g, mint, user: e.whale.publicKey, quoteMint: e.Q };
  const ixs = await buyExactIn({ ...side, spend, minOut: new BN(1) });
  await land(e, { id, step, payer: e.whale, ixs }, async () => ({
    spend: spend.toString(),
    complete: (await readCurve(e.online, mint)).complete,
  }));
}

async function migrate(e: E, id: string, mint: PublicKey): Promise<void> {
  const ixs = await migrateIxs({ global: e.g, user: e.ops.publicKey, mint, quoteMint: e.Q });
  const step = "migrate_v2 by the stage: the fork runs no keeper (Pitfall 6)";
  await land(e, { id, step, payer: e.ops, ixs }, async () => ({}));
}

export const pick = (out: Landed[], kind: string) => out.find((l) => l.rows?.[0]?.kind === kind);

// One row per engine tx, its facts from the landed ledger entry. A step that did not land records, then throws.
export function record(e: E, id: string, step: string, l: Landed | undefined, facts: Facts = {}): void {
  const entry = l?.rows?.[0];
  const detail = (entry?.detail ?? {}) as Record<string, string>;
  e.ctx.record({
    ...{ id, step, ok: l?.state === "landed", sig: l?.sig, cu: l?.meta?.computeUnitsConsumed },
    facts: {
      ...{ state: l?.state ?? "missing", amount: String(entry?.amount ?? -1) },
      ...(entry?.burned === undefined ? {} : { burned: String(entry.burned) }),
      ...(detail.path ? { path: detail.path } : {}),
      ...facts,
    },
  });
  if (l?.state !== "landed") throw new Error(`${id}: ${l?.state ?? "missing"}`);
}

const after = async (e: E, mint: PublicKey, w: Keypair, supplyBefore: string): Promise<Facts> => ({
  supplyBefore,
  supplyAfter: await supply(e, mint),
  wChildAfter: await tokenAmount(e.ctx, mint, w.publicKey),
  complete: (await readCurve(e.online, mint)).complete,
});

async function forcedPath(e: E): Promise<void> {
  const { mint, W } = await createChild(e, "aux.engine.create.1", "E1");
  const raise = await costToComplete(e.online, mint);
  await whaleBuy(e, "aux.engine.buy.1", mint, raise.divn(5), "Whale curve buy on E1, so creator fees accrue");
  const cost = await costToComplete(e.online, mint);
  const budget = cost.muln(106).divn(100);
  await topUp(e, "aux.engine.topup.1", W.publicKey, budget, {
    cost: cost.toString(),
    budget: budget.toString(),
  });
  // The indexer's memory after the whale buy: forcedJob collects only when fees are unclaimed (73853e4), and
  // with no BONDR price any amount is worth it.
  const coin = { ...coinOf(e, mint, W, "curve"), feesUnclaimed: 1n };
  const before = await supply(e, mint);
  const out = await forcedJob(e.d, coin);
  record(
    e,
    "engine.collect",
    "Engine collectJob (urgent) on E1: sweep + collect into W",
    pick(out, "collect"),
  );
  record(
    e,
    "engine.split",
    "Engine splitJob (urgent): a tenth of the collect to the treasury",
    pick(out, "split_treasury"),
  );
  const forced = pick(out, "forced_bond");
  const step =
    "Engine forcedJob: fresh cost re-check, buy_exact_quote_in_v3 of W's whole budget + BurnChecked";
  record(e, "engine.forced", step, forced, await after(e, mint, W, before));
  await migrate(e, "aux.engine.migrate.1", mint);
  const bonded = await bondedJob(e.d, { ...coin, venue: "pool" });
  e.ctx.record({
    ...{ id: "aux.engine.bonded.1", step: "Engine bondedJob on E1 after its forced bond" },
    ...{
      ok: bonded.every((l) => l.state === "landed" || l.state === "done"),
      sig: pick(bonded, "collect")?.sig,
    },
    facts: {
      states: bonded.map((l) => l.state).join(","),
      poolBurns: bonded.filter((l) => pick([l], "pool_burn")).length,
    },
  });
}

async function bondedPath(e: E): Promise<void> {
  const { mint, W } = await createChild(e, "aux.engine.create.2", "E2");
  const buy = (await costToComplete(e.online, mint)).muln(106).divn(100);
  await whaleBuy(e, "aux.engine.buy.2", mint, buy, "Whale buys the whole E2 curve (traders bond first)");
  await migrate(e, "aux.engine.migrate.2", mint);
  const before = await supply(e, mint);
  const out = await bondedJob(e.d, coinOf(e, mint, W, "pool"));
  record(e, "engine.collect.2", "Engine collectJob (urgent) on migrated E2", pick(out, "collect"));
  record(e, "engine.split.2", "Engine splitJob (urgent) on E2", pick(out, "split_treasury"));
  const step = "Engine poolBurnJob: PumpSwap buy of W's whole budget + BurnChecked, one tx";
  record(e, "engine.pool.burn", step, pick(out, "pool_burn"), await after(e, mint, W, before));
  // 05-08 finalizes E2: its W, launch signature and dev wallet.
  const s = e.ctx.file.state;
  s["E2.W"] = W.publicKey.toBase58();
  s["E2.sig"] = e.ctx.file.rows.find((r) => r.id === "aux.engine.create.2")?.sig ?? "";
  s["E2.dev"] = e.ctx.key("sim", "dev").publicKey.toBase58();
}

const splitRule =
  (collectId: string): Rule =>
  (row, file) => {
    if (!row.sig) return "no signature";
    const c = BigInt(file.rows.find((r) => r.id === collectId)?.facts?.amount ?? -1);
    return BigInt(row.facts?.amount ?? -1) === c / 10n ? null : `split ${row.facts?.amount}, collect ${c}`;
  };

const burnRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.wChildAfter !== "0") return `W still holds ${f.wChildAfter} child tokens`;
  return burned(f) === BigInt(f.burned ?? -1) ? null : `supply dropped ${burned(f)}, burned ${f.burned}`;
};

const forcedRule: Rule = (row, file) => {
  if (row.facts?.complete !== true) return "curve not complete after the forced bond";
  const e1 = file.rows.find((r) => r.id === "aux.engine.bonded.1")?.facts;
  return burnRule(row, file) ?? (e1?.poolBurns === 0 ? null : "E1 got a pool_burn after its forced bond");
};

export const engineBondStage: Stage = {
  name: "engine",
  rules: () => ({
    "engine.collect": sigOk,
    "engine.split": splitRule("engine.collect"),
    "engine.forced": forcedRule,
    "engine.collect.2": sigOk,
    "engine.split.2": splitRule("engine.collect.2"),
    "engine.pool.burn": burnRule,
  }),
  async run(ctx) {
    const run = await newRun(ctx);
    const e = { ...run, d: feeDeps(run) };
    await forcedPath(e);
    await bondedPath(e);
  },
};
