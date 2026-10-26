// D-39 on the fork: the five post-bond recovery actions through the worker's own admin money path (simulate, a
// signed intent, execute, audit settle), the path the console uses. Devnet cannot bond a child (Phase 5 D-06).
// One fresh child AD: a whale buy and a TOP-UP, Retry forced bond; Run migrate; a known child amount sent to W,
// Burn W token balance; two pool trades, Finalize split; two more, Distribute now. The stage moves the coin's
// venue between actions, as the indexer's events would.

import { costToComplete, readCurve } from "@bondr/core/curve";
import { COIN_DECIMALS } from "@bondr/core/launch";
import { canonicalPumpPoolPdaWithQuote } from "@bondr/core/pump";
import { ataIx } from "@bondr/core/trade";
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import type { Rule, Stage } from "../results.ts";
import { type A, act, adminRun, entryOf, recordAct, simChange } from "./admin-steps.ts";
import { burned, land, newRun, supply, topUp } from "./bond.ts";
import { whaleBuy } from "./engine-bond.ts";
import { distributeRule, finalUpdateRule, shares, trades } from "./engine-final.ts";
import { tokenAmount } from "./launch.ts";

const bal = async (a: A, mint: PublicKey, owner: PublicKey) => BigInt(await tokenAmount(a.ctx, mint, owner));

async function forced(a: A): Promise<void> {
  const { mint, w } = a.coin;
  const raise = await costToComplete(a.online, mint);
  await whaleBuy(a, "aux.admin.buy", mint, raise.divn(5), "Whale curve buy on AD, so creator fees accrue");
  const cost = await costToComplete(a.online, mint);
  const budget = cost.muln(106).divn(100);
  await topUp(a, "aux.admin.topup", w.publicKey, budget, {
    cost: cost.toString(),
    budget: budget.toString(),
  });
  // The indexer's memory after the TOP-UP; no unclaimed fees, so the action is one tx and its preview exact.
  a.coin.feeBudget = BigInt(budget.toString());
  const [supplyBefore, wBefore] = [await supply(a, mint), await bal(a, a.Q, w.publicKey)];
  const r = await act(a, "retry_forced_bond");
  const e = entryOf(a, "forced_bond");
  const step =
    "Admin Retry forced bond: simulate, signed intent, execute (buy_exact_quote_in_v3 + BurnChecked)";
  recordAct(a, "admin.forced", step, r, e?.signature, {
    ...{ supplyBefore, supplyAfter: await supply(a, mint), burned: String(e?.burned ?? -1) },
    complete: (await readCurve(a.online, mint)).complete,
    simW: String(simChange(r.sim, "W ", "BONDR")),
    landedW: String((await bal(a, a.Q, w.publicKey)) - wBefore),
  });
  a.coin.venue = "complete";
}

async function migrate(a: A): Promise<void> {
  const pool = canonicalPumpPoolPdaWithQuote(a.coin.mint, a.Q);
  const r = await act(a, "run_migrate");
  const step = "Admin Run migrate: migrate_v2 with ops as the user, through simulate and execute";
  recordAct(a, "admin.migrate", step, r, r.view.sigs[0], {
    ...{ pool: pool.toBase58(), poolExists: !!(await a.ctx.conn.getAccountInfo(pool)) },
  });
  a.coin.venue = "pool";
}

// A known amount of the whale's child tokens lands in W, as a stray transfer would leave it.
async function leftover(a: A): Promise<void> {
  const { mint, w } = a.coin;
  const amount = (await bal(a, mint, a.whale.publicKey)) / 10n;
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, T22);
  const [from, to] = [ata(a.whale.publicKey), ata(w.publicKey)];
  const give = createTransferCheckedInstruction(
    from,
    mint,
    to,
    a.whale.publicKey,
    amount,
    COIN_DECIMALS,
    [],
    T22,
  );
  const ixs = [ataIx(a.whale.publicKey, mint, w.publicKey), give];
  const stray = `Whale sends ${amount} AD child tokens to W (a stray transfer)`;
  await land(a, { id: "aux.admin.leftover.give", step: stray, payer: a.whale, ixs }, async () => ({}));
  const [supplyBefore, wChildBefore] = [await supply(a, mint), await bal(a, mint, w.publicKey)];
  const r = await act(a, "burn_w_tokens");
  const e = entryOf(a, "leftover_burn");
  recordAct(
    a,
    "admin.leftover",
    "Admin Burn W token balance: BurnChecked of W's whole child balance",
    r,
    e?.signature,
    {
      ...{ amount: String(amount), wChildBefore: String(wChildBefore), supplyBefore },
      ...{ supplyAfter: await supply(a, mint), wChildAfter: await tokenAmount(a.ctx, mint, w.publicKey) },
      simChild: String(simChange(r.sim, "W ", "tokens")),
    },
  );
}

async function finalize(a: A): Promise<void> {
  await trades(a, "admin.final");
  const r = await act(a, "finalize_split");
  const step = "Admin Finalize split: deployer = AD's recorded wallet, config + the one 8000 / 2000 update";
  recordAct(a, "admin.finalize", step, r, entryOf(a, "finalize_update")?.signature, await shares(a));
  // engine.landed() does this from the update's publish in the worker; the fork deps publish nothing.
  a.coin.finalize = "done";
}

async function distribute(a: A): Promise<void> {
  await trades(a, "admin.distribute");
  const dev = a.coin.wallet;
  const before = await bal(a, a.Q, dev);
  const r = await act(a, "distribute_now");
  const e = entryOf(a, "distribute");
  const detail = (e?.detail ?? {}) as Record<string, string>;
  recordAct(
    a,
    "admin.distribute",
    "Admin Distribute now: the 80:20 payout, no batch minimum",
    r,
    e?.signature,
    {
      ...{ deployerAmount: detail.deployerAmount ?? "-1", treasuryAmount: detail.treasuryAmount ?? "-1" },
      simDeployer: String(simChange(r.sim, "Deployer", "BONDR")),
      landedDeployer: String((await bal(a, a.Q, dev)) - before),
    },
  );
}

const off = (x: unknown, y: unknown) => {
  const d = BigInt(String(x ?? 0)) - BigInt(String(y ?? 0));
  return d < 0n ? -d : d;
};

// D-33: no rule passes unless the action's audit row settled landed with every signature.
const audited =
  (rule: Rule): Rule =>
  (row, file) =>
    row.facts?.audit === "landed" ? rule(row, file) : `audit ${row.facts?.audit ?? "missing"}`;

const forcedRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.complete !== true) return "curve not complete after the forced bond";
  if (burned(f) !== BigInt(f.burned ?? -1)) return `supply dropped ${burned(f)}, bought ${f.burned}`;
  return off(f.simW, f.landedW) <= 1n ? null : `W change simulated ${f.simW}, landed ${f.landedW}`;
};

const migrateRule: Rule = (row) =>
  !row.sig ? "no signature" : row.facts?.poolExists === true ? null : "pool account missing after migrate";

const leftoverRule: Rule = (row) => {
  const f = row.facts ?? {};
  if (!row.sig) return "no signature";
  if (f.wChildAfter !== "0") return `W still holds ${f.wChildAfter} child tokens`;
  if (burned(f) !== BigInt(f.amount ?? -1)) return `supply dropped ${burned(f)}, sent ${f.amount}`;
  return off(f.simChild, -burned(f)) <= 1n ? null : `simulated ${f.simChild}, supply dropped ${burned(f)}`;
};

const distributeExact: Rule = (row, file) =>
  distributeRule(row, file) ??
  (off(row.facts?.simDeployer, row.facts?.landedDeployer) <= 1n
    ? null
    : `deployer simulated ${row.facts?.simDeployer}, landed ${row.facts?.landedDeployer}`);

export const adminStage: Stage = {
  name: "admin",
  rules: () => ({
    "admin.forced": audited(forcedRule),
    "admin.migrate": audited(migrateRule),
    "admin.leftover": audited(leftoverRule),
    "admin.finalize": audited(finalUpdateRule("AD.dev")),
    "admin.distribute": audited(distributeExact),
  }),
  async run(ctx) {
    const a = await adminRun(await newRun(ctx));
    await forced(a);
    await migrate(a);
    await leftover(a);
    await finalize(a);
    await distribute(a);
  },
};
