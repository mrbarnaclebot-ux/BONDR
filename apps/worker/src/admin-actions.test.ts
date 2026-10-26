// The recovery action registry (ADMIN-03, D-15, D-16, RESEARCH Pattern 4): when each action applies, where its
// funds may go and which engine job it runs. The job modules pass through to the real code, so the finalize
// capture run builds real instructions; the mapping tests stub one call each.
import { BN } from "@bondr/core/pump";
import {
  AccountLayout,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { type AccountInfo, Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { ACTIONS, type ActionView, actionView, runOn } from "./admin-actions.ts";
import { type Allowed, passedLines, refusedDestination, short } from "./admin-dest.ts";
import { leftoverBurnJob, sweepLeftoversJob } from "./admin-leftover.ts";
import { captureDeps, type Step } from "./admin-sim.ts";
import { buybackBurnJob, distributeJob } from "./fee-batch.ts";
import { forcedJob } from "./fee-burns.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { windowJob } from "./fee-guard.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import { settleRows } from "./fee-recover.ts";
import type { FeeCoin, FeeDeps } from "./fee-send.ts";

const m = vi.hoisted(() => ({
  state: { complete: true, pool: null as unknown, sharing: "none" },
  cost: 1000n,
  costCalls: 0,
}));
vi.mock("@bondr/core/sharing", async (orig) => ({
  ...((await orig()) as object),
  finalizeState: async () => m.state,
}));
vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async () => [],
}));
vi.mock("@bondr/core/curve", async (orig) => ({
  ...((await orig()) as object),
  costToComplete: async () => {
    m.costCalls++;
    return new BN(m.cost.toString());
  },
}));
vi.mock("@bondr/core/bond", async (orig) => ({
  ...((await orig()) as object),
  migrateIxs: vi.fn(async () => [{ marker: "migrate" }]),
}));
// Each named export becomes a spy that still runs the real job.
const { pass } = vi.hoisted(() => ({
  pass: (names: string[]) => async (orig: () => Promise<unknown>) => {
    const o = (await orig()) as Record<string, (...a: unknown[]) => unknown>;
    return { ...o, ...Object.fromEntries(names.map((n) => [n, vi.fn(o[n])])) };
  },
}));
vi.mock("./fee-guard.ts", pass(["windowJob"]));
vi.mock("./fee-burns.ts", pass(["forcedJob"]));
vi.mock("./fee-finalize.ts", pass(["finalizeJob"]));
vi.mock("./fee-batch.ts", pass(["distributeJob", "buybackBurnJob"]));
vi.mock("./fee-recover.ts", pass(["settleRows"]));
vi.mock("./admin-leftover.ts", pass(["leftoverBurnJob", "sweepLeftoversJob"]));

const Q = PublicKey.unique();
const MINT = PublicKey.unique();
const W = Keypair.generate();
const OPS = Keypair.generate();
const BUYBACK = Keypair.generate();
const TREASURY = Keypair.generate().publicKey;
const DEPLOYER = Keypair.generate().publicKey;
const DAY = 86_400_000;
const W_NAME = `W ${short(W.publicKey)}`;
const ataOf = (mint: PublicKey, owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, T22);

function tokenAccount(amount: bigint): AccountInfo<Buffer> {
  const data = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode(
    {
      ...{ mint: Q, owner: PublicKey.default, amount, delegateOption: 0, delegate: PublicKey.default },
      ...{ state: 1, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0 },
      closeAuthority: PublicKey.default,
    },
    data,
  );
  return { data, owner: T22, lamports: 2_039_280, executable: false };
}

const coin = (o: Partial<FeeCoin> = {}): FeeCoin => ({
  ...{ mint: MINT, w: W, launchedAt: Date.now() - 3.5 * DAY, venue: "curve", feesUnclaimed: 0n },
  ...{ feeBudget: 0n, cost: null, launchSig: "l", wallet: DEPLOYER, finalize: "none" },
  ...o,
});
const view = (o: Partial<ActionView> = {}): ActionView => ({
  ...{ coin: coin(), mint: MINT.toBase58(), wChild: 0n, buybackBondr: 0n, costNow: null },
  ...{ failedSweep: null, pendingSweeps: [] },
  ...o,
});

let balances: Map<string, bigint>;
function deps(mode: "dry" | "on" = "on"): FeeDeps {
  const amount = (k: PublicKey) => balances.get(k.toBase58());
  return {
    ...{ net: "devnet", mode, Q, ops: OPS, treasury: TREASURY, buyback: BUYBACK, ledger: memoryLedger() },
    ...{ windowMs: DAY, bondrSol: () => 1, publish: () => {}, allowed: () => false },
    online: { fetchGlobal: async () => ({ global: true }) },
    land: vi.fn(async () => ({ state: "landed", sig: "s" })),
    conn: {
      getMultipleAccountsInfo: async (keys: PublicKey[]) =>
        keys.map((k) => (amount(k) === undefined ? null : tokenAccount(amount(k) ?? 0n))),
      getTokenAccountBalance: async (k: PublicKey) => ({ value: { amount: String(amount(k) ?? 0n) } }),
      getMinimumBalanceForRentExemption: async () => 1_000_000,
      getBalance: async () => 0,
      simulateTransaction: async () => ({ value: { err: null, unitsConsumed: 1, accounts: null } }),
    },
  } as unknown as FeeDeps;
}

beforeEach(() => {
  balances = new Map();
  m.costCalls = 0;
  vi.clearAllMocks();
});

test("ACTIONS holds the nine transaction actions, each with applies, allow, watch and run", () => {
  const nine = ["sweep_now", "retry_forced_bond", "burn_w_tokens", "run_migrate", "finalize_split"];
  nine.push("retry_sweep", "distribute_now", "sweep_leftovers", "burn_buyback");
  expect(Object.keys(ACTIONS).sort()).toEqual(nine.sort());
  for (const def of Object.values(ACTIONS))
    for (const fn of [def.applies, def.allow, def.watch, def.run]) expect(fn).toBeTypeOf("function");
});

const pool = (o: Partial<FeeCoin> = {}) => coin({ venue: "pool", ...o });
const platform = (buybackBondr = 0n) => view({ coin: null, mint: null, buybackBondr });
const [curve, pooled] = [view(), view({ coin: pool() })];
const [held, done] = [view({ coin: pool({ finalize: "held" }) }), view({ coin: pool({ finalize: "done" }) })];
const bond = (feeBudget: bigint, costNow: bigint | null, o: Partial<FeeCoin> = {}) =>
  view({ coin: coin({ feeBudget, ...o }), costNow });
const BOND_YES = [bond(1050n, 1000n), bond(1000n, 1000n, { feesUnclaimed: 100n })];
// Below 105%, off the curve, or a cost of 0 (the curve completed: the migration event bonds it instead).
const BOND_NO = [bond(1049n, 1000n), bond(5000n, 1000n, { venue: "pool" }), bond(9n, 0n), bond(9n, null)];
const MATRIX: [keyof typeof ACTIONS, ActionView[], ActionView[], string][] = [
  ["sweep_now", [curve], [pooled, view({ coin: null })], "not_curve"],
  ["retry_forced_bond", BOND_YES, BOND_NO, "below_trigger"],
  ["burn_w_tokens", [view({ wChild: 1n })], [curve], "no_child"],
  ["run_migrate", [view({ coin: coin({ venue: "complete" }) })], [curve, pooled], "not_complete"],
  ["finalize_split", [pooled, held], [curve, done], "not_bonded"],
  ["retry_sweep", [view({ failedSweep: { windowIndex: 2 } })], [curve], "no_failed_sweep"],
  ["distribute_now", [done], [pooled, held], "not_finalized"],
  ["sweep_leftovers", [done], [pooled, held], "not_finalized"],
  ["burn_buyback", [platform(5n)], [platform()], "no_bondr"],
];

test.each(MATRIX)("%s applies only in its state", (action, yes, no, reason) => {
  for (const v of yes) expect(ACTIONS[action].applies(v)).toBeNull();
  for (const v of no) expect(ACTIONS[action].applies(v)).toBe(reason);
});

const names = (a: Allowed) => [...a.owners.values()].sort();

test("finalize_split allows the launch wallet as the only deployer (D-15)", () => {
  const d = deps();
  const a = ACTIONS.finalize_split.allow(view({ coin: pool() }), d);
  expect(names(a)).toEqual(["Buyback", `Deployer ${short(DEPLOYER)}`, "Treasury", W_NAME]);
  expect(a.owners.has(DEPLOYER.toBase58())).toBe(true);
  expect(a.owners.has(Keypair.generate().publicKey.toBase58())).toBe(false);
  expect(passedLines(a)[0]).toBe("deployer matches the launch signer");
  const h = ACTIONS.finalize_split.allow(view({ coin: pool({ finalize: "held" }) }), d);
  expect(passedLines(h)[0]).toBe("deployer is the recorded launch wallet"); // WR-W-03: no signer proof ran
});

test("each action's allowlist names only its destinations plus the coin's own W", () => {
  const [d, v] = [deps(), view({ coin: pool({ finalize: "done" }) })];
  const of = (action: keyof typeof ACTIONS, at = v) => names(ACTIONS[action].allow(at, d));
  for (const burn of ["burn_w_tokens", "run_migrate", "distribute_now"] as const)
    expect(of(burn)).toEqual([W_NAME]);
  expect(of("burn_buyback", platform(1n))).toEqual([]);
  for (const sweep of ["sweep_now", "retry_sweep", "sweep_leftovers"] as const)
    expect(of(sweep)).toEqual(["Buyback", "Treasury", W_NAME]);
  expect(of("retry_forced_bond")).toEqual(["Treasury", W_NAME]);
});

test("watch names the accounts the balance table shows, ops first", () => {
  const d = deps();
  const rows = (action: keyof typeof ACTIONS, v = view({ coin: pool() })) =>
    ACTIONS[action].watch(v, d).map((w) => w.name);
  const final = ["Treasury", "Buyback", W_NAME, `Deployer ${short(DEPLOYER)}`, "Fee sharing config"];
  expect(rows("finalize_split")).toEqual(expect.arrayContaining(final));
  expect(rows("burn_buyback", platform(1n))).toEqual(["Ops wallet", "Buyback"]);
  for (const action of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[])
    expect(rows(action, action === "burn_buyback" ? platform(1n) : view())[0]).toBe("Ops wallet");
});

test("run maps each action to its engine job", async () => {
  const [d, c] = [deps(), coin()];
  const v = view({ coin: c });
  vi.mocked(windowJob).mockResolvedValue([]);
  await ACTIONS.sweep_now.run(d, v);
  expect(windowJob).toHaveBeenCalledWith(d, c, 3); // that window's sweep, early (A9)
  vi.mocked(finalizeJob).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
  await ACTIONS.finalize_split.run(d, v);
  expect(finalizeJob).toHaveBeenLastCalledWith(d, c, undefined); // never held: the launch-signer proof runs
  const h = coin({ finalize: "held" });
  await ACTIONS.finalize_split.run(d, view({ coin: h }));
  expect(finalizeJob).toHaveBeenLastCalledWith(d, h, DEPLOYER); // held: the owner's override (WR-W-03)
  vi.mocked(distributeJob).mockResolvedValueOnce({ state: "done" });
  expect(await ACTIONS.distribute_now.run(d, v)).toEqual([{ state: "done" }]);
  expect(distributeJob).toHaveBeenCalledWith(d, c, { anyAmount: true });
  vi.mocked(forcedJob).mockResolvedValueOnce([]);
  vi.mocked(leftoverBurnJob).mockResolvedValueOnce({ state: "done" });
  vi.mocked(sweepLeftoversJob).mockResolvedValueOnce([]);
  for (const a of ["retry_forced_bond", "burn_w_tokens", "sweep_leftovers"] as const)
    await ACTIONS[a].run(d, v);
  for (const job of [forcedJob, leftoverBurnJob, sweepLeftoversJob]) expect(job).toHaveBeenCalledWith(d, c);
  vi.mocked(buybackBurnJob).mockResolvedValueOnce({ state: "done" });
  await ACTIONS.burn_buyback.run(d, platform(1n));
  expect(buybackBurnJob).toHaveBeenCalledWith(d);
});

test("run_migrate lands migrate_v2 with no ledger row and ops as the user", async () => {
  const d = deps();
  const out = await ACTIONS.run_migrate.run(d, view({ coin: coin({ venue: "complete" }) }));
  expect(out).toEqual([{ state: "landed", sig: "s" }]);
  const { migrateIxs } = await import("@bondr/core/bond");
  const ids = { global: { global: true }, user: OPS.publicKey, mint: MINT, quoteMint: Q };
  expect(migrateIxs).toHaveBeenCalledWith(ids);
  const job = { rows: [], ixs: [{ marker: "migrate" }], signers: [] };
  expect(d.land).toHaveBeenCalledWith(expect.objectContaining(job));
});

test("retry_sweep settles the pending sweeps from chain, then reruns the failed window", async () => {
  const c = coin();
  const pending = [
    { id: 1, kind: "sweep_buyback", signature: "p" },
  ] as unknown as ActionView["pendingSweeps"];
  const v = view({ coin: c, failedSweep: { windowIndex: 2 }, pendingSweeps: pending });
  vi.mocked(settleRows).mockResolvedValue(0);
  vi.mocked(windowJob).mockResolvedValue([]);
  const d = deps();
  await ACTIONS.retry_sweep.run(d, v);
  expect(settleRows).toHaveBeenCalledWith(d, pending, expect.any(Function));
  expect(windowJob).toHaveBeenCalledWith(d, c, 2);
  vi.mocked(settleRows).mockClear();
  await ACTIONS.retry_sweep.run(deps("dry"), v);
  expect(settleRows).not.toHaveBeenCalled(); // a simulation writes nothing
});

test("runOn uses the coin's queue when the engine exists and runs directly without it", async () => {
  const exclusive = vi.fn(async (_mint: string, fn: () => Promise<unknown>) => fn());
  const engine = { exclusive } as never;
  expect(await runOn(engine, "m", async () => 7)).toBe(7);
  expect(exclusive).toHaveBeenLastCalledWith("m", expect.any(Function));
  await runOn(engine, null, async () => 1);
  expect(exclusive).toHaveBeenLastCalledWith("platform", expect.any(Function)); // burn_buyback's queue
  expect(await runOn(null, "m", async () => 8)).toBe(8);
});

test("actionView reads the engine coin, W's child balance, the buyback, the fresh cost and the sweep rows", async () => {
  const d = deps();
  const c = coin();
  balances.set(ataOf(MINT, W.publicKey).toBase58(), 42n);
  balances.set(ataOf(Q, BUYBACK.publicKey).toBase58(), 7n);
  const mint = MINT.toBase58();
  await d.ledger.insertPending([{ kind: "sweep_treasury", mint, windowIndex: 2 }], "f", 1n);
  await d.ledger.settle("f", "failed", { error: "boom" });
  await d.ledger.insertPending([{ kind: "sweep_buyback", mint, windowIndex: 3 }], "p", 1n);
  const load = vi.fn();
  const v = await actionView(d, mint, { coin: () => c }, load);
  expect(v.coin).toBe(c);
  expect(v).toMatchObject({ mint, wChild: 42n, buybackBondr: 7n, costNow: 1000n });
  expect(v.failedSweep).toEqual({ windowIndex: 2 });
  expect(v.pendingSweeps.map((e) => e.signature)).toEqual(["p"]);
  expect(load).not.toHaveBeenCalled();
});

test("actionView loads the coin with the engine off and skips the cost off the curve", async () => {
  const d = deps();
  const v = await actionView(d, MINT.toBase58(), null, async () => pool());
  expect(v).toMatchObject({ wChild: 0n, costNow: null, failedSweep: null });
  expect(v.coin?.venue).toBe("pool");
  expect(m.costCalls).toBe(0);
  const p = await actionView(d, null, null, vi.fn());
  expect(p).toMatchObject({ coin: null, mint: null, buybackBondr: 0n });
});

test("a finalize_split capture run passes its own allowlist on every step and names the launch wallet", async () => {
  m.state = { complete: true, pool: PublicKey.unique(), sharing: "none" };
  balances.set(ataOf(Q, W.publicKey).toBase58(), 1000n);
  balances.set(ataOf(MINT, W.publicKey).toBase58(), 5n);
  const d = deps();
  const v = view({ coin: pool({ finalize: "held" }) });
  const sink: Step[] = [];
  const out = await ACTIONS.finalize_split.run(captureDeps(d, sink, ACTIONS.finalize_split.watch(v, d)), {
    ...v,
    coin: { ...(v.coin as FeeCoin) },
  });
  expect(out.every((l) => l.state === "dry")).toBe(true);
  expect(sink.length).toBeGreaterThanOrEqual(4); // config, update, closing collect and sweep, leftover burn
  const allow = ACTIONS.finalize_split.allow(v, d);
  for (const s of sink) expect(refusedDestination(s.ixs, allow)).toBeNull();
  const namesDeployer = (ix: TransactionInstruction) =>
    ix.keys.some((k) => k.pubkey.equals(DEPLOYER)) || ix.data.includes(DEPLOYER.toBuffer());
  expect(sink.some((s) => s.ixs.some(namesDeployer))).toBe(true); // the update's new shareholder
  expect(v.coin?.finalize).toBe("held");
  expect(d.land).not.toHaveBeenCalled();
});
