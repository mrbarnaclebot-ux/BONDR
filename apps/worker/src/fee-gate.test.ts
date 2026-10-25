// The kill switch gate at the top of each fee job (D-19, Pattern 7) and the last-run marks (D-26). A gate fires
// before any read, so most cases need only allowed, a land spy and a conn that throws on every call.
import { BN } from "@bondr/core/pump";
import { Keypair, PublicKey } from "@solana/web3.js";
import { beforeEach, expect, test, vi } from "vitest";
import { buybackBurnJob, distributeJob } from "./fee-batch.ts";
import { feeDeps } from "./fee-boot.ts";
import { bondedJob, forcedJob, poolBurnJob } from "./fee-burns.ts";
import { finalizeJob } from "./fee-finalize.ts";
import { windowJob } from "./fee-guard.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import type { FeeCoin, FeeDeps, Job, Landed } from "./fee-send.ts";
import { marks } from "./health.ts";

const m = vi.hoisted(() => ({
  off: new Set<string>(),
  finalizeState: vi.fn(async () => ({ complete: false, pool: null, sharing: "none" })),
}));
vi.mock("./switches.ts", () => ({ switchOn: (job: string) => !m.off.has(job) }));
vi.mock("@bondr/core/sharing", async (orig) => ({
  ...((await orig()) as object),
  finalizeState: m.finalizeState,
}));
vi.mock("@bondr/core/collect", async (orig) => ({
  ...((await orig()) as object),
  collectIxs: async () => [],
}));
vi.mock("@bondr/core/curve", async (orig) => ({
  ...((await orig()) as object),
  costToComplete: async () => new BN(1000),
}));
vi.mock("@bondr/core/float", () => ({ wFloat: async () => 0 }));
vi.mock("@bondr/core/bond", () => ({
  forcedBondIxs: async () => ({ ixs: [], burnAmount: new BN(777) }),
}));

const Q = PublicKey.unique();
const W = Keypair.generate();
const MINT = PublicKey.unique();
const coin = (o: Partial<FeeCoin> = {}): FeeCoin => ({
  ...{ mint: MINT, w: W, launchedAt: 0, venue: "curve", feesUnclaimed: 0n, feeBudget: 0n },
  ...{ cost: null, launchSig: "launch", wallet: PublicKey.unique(), finalize: "none" },
  ...o,
});
const meta = (wDelta: bigint) => ({
  err: null,
  preTokenBalances: [
    { mint: Q.toBase58(), owner: W.publicKey.toBase58(), uiTokenAmount: { amount: "10000" } },
  ],
  postTokenBalances: [
    {
      mint: Q.toBase58(),
      owner: W.publicKey.toBase58(),
      uiTokenAmount: { amount: String(10_000n + wDelta) },
    },
  ],
});

let jobs: Job[];
let asked: [string, FeeCoin | null][];
const throws = () => {
  throw new Error("read after the gate");
};

// allowed: the jobs that may run (undefined leaves allowed absent). balance: W's BONDR, read only when given.
function deps(o: { allowed?: string[]; balance?: bigint; metas?: object[] } = {}): FeeDeps {
  const ledger = memoryLedger();
  const metas = [...(o.metas ?? [])];
  const ok = o.allowed;
  const balance = async () => {
    if (o.balance === undefined) return throws();
    return { value: { amount: String(o.balance) } };
  };
  const d = {
    ...{ net: "devnet", mode: "on", Q, ops: Keypair.generate(), amm: {}, ledger },
    ...{ treasury: PublicKey.unique(), buyback: Keypair.generate(), publish: () => {}, bondrSol: () => 1 },
    online: { fetchGlobal: async () => ({}) },
    conn: { getTokenAccountBalance: balance, getMultipleAccountsInfo: async () => [null, null, null, null] },
    ...(ok && {
      allowed: (job: string, c: FeeCoin | null) => {
        asked.push([job, c]);
        return ok.includes(job);
      },
    }),
    async land(job: Job): Promise<Landed> {
      jobs.push(job);
      const sig = `s${jobs.length}`;
      await ledger.insertPending(job.rows, sig, 1n);
      const facts = job.facts?.((metas.shift() ?? meta(0n)) as never);
      return { state: "landed", sig, rows: await ledger.settle(sig, "landed", { facts }) };
    },
  };
  return d as unknown as FeeDeps;
}

const ALL = ["sweeps", "forcedBond", "finalize", "buybackBurn"];
const SKIPPED = { state: "skipped" };
const but = (job: string) => ALL.filter((j) => j !== job);

beforeEach(() => {
  jobs = [];
  asked = [];
  m.off.clear();
  m.finalizeState.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// First: the marks are module memory and no earlier test has run a job.
test("each job stamps its last run; a job that never ran reports null", async () => {
  expect(Object.values(marks()).every((t) => t === null)).toBe(true);
  const t0 = Date.now();
  await windowJob(deps({ balance: 0n }), coin(), 0);
  await forcedJob(deps({ balance: 0n }), coin());
  for (const k of ["split", "sweep", "bondCheck"] as const) expect(marks()[k]).toBeGreaterThanOrEqual(t0);
  expect(marks().distribute).toBe(null);
  await distributeJob(deps(), coin({ venue: "pool", finalize: "done" }));
  await buybackBurnJob(deps({ balance: 0n }));
  expect(marks().distribute).toBeGreaterThanOrEqual(t0);
  expect(marks().buyback).toBeGreaterThanOrEqual(t0);
  expect(marks().stream).toBe(null);
});

test("windowJob with sweeps paused skips and sends nothing; with allowed absent it runs as before", async () => {
  expect(await windowJob(deps({ allowed: but("sweeps") }), coin({ feesUnclaimed: 10_000n }), 0)).toEqual([
    SKIPPED,
  ]);
  expect(jobs).toEqual([]);
  expect(asked.map(([j]) => j)).toEqual(["sweeps"]);
  expect(await windowJob(deps({ balance: 0n }), coin(), 0)).toEqual([{ state: "done" }]);
});

test("forcedJob and poolBurnJob skip with forcedBond paused; bondedJob then stops before finalize", async () => {
  const d = deps({ allowed: but("forcedBond") });
  expect(await forcedJob(d, coin({ feesUnclaimed: 10_000n }))).toEqual([SKIPPED]);
  expect(await poolBurnJob(d, coin({ venue: "pool" }))).toEqual(SKIPPED);
  const out = await bondedJob(d, coin({ venue: "pool" }));
  expect(out.at(-1)).toEqual(SKIPPED);
  expect(jobs).toEqual([]);
  expect(m.finalizeState).not.toHaveBeenCalled();
});

// Pattern 7, T-06-07-04: the gate is per job, so the forced bond's urgent collect ignores the sweeps switch.
test("with sweeps paused the forced bond still collects, splits and lands", async () => {
  const d = deps({ allowed: but("sweeps"), balance: 1050n, metas: [meta(1000n), meta(-100n), meta(-1040n)] });
  await forcedJob(d, coin({ feesUnclaimed: 10_000n }));
  expect(jobs.map((j) => j.rows[0]?.kind)).toEqual(["collect", "split_treasury", "forced_bond"]);
});

test("finalizeJob and distributeJob skip with finalize paused; buybackBurnJob with buybackBurn paused", async () => {
  const d = deps({ allowed: but("finalize") });
  const pooled = coin({ venue: "pool", finalize: "done" });
  expect(await finalizeJob(d, coin({ venue: "pool" }))).toEqual([SKIPPED]);
  expect(await distributeJob(d, pooled)).toEqual(SKIPPED);
  expect(m.finalizeState).not.toHaveBeenCalled();
  expect(await buybackBurnJob(deps({ allowed: but("buybackBurn") }))).toEqual(SKIPPED);
  expect(asked.at(-1)).toEqual(["buybackBurn", null]);
  expect(jobs).toEqual([]);
});

test("the engine's deps allow a job only while its switch is on and the coin has no manual hold", () => {
  const ctx = { conn: {}, online: {}, Q, priorityFee: 0 } as never;
  const env = { net: "devnet", seed: Buffer.alloc(32, 7), lane: "local", feeWindowMs: 1000 } as never;
  const d = feeDeps(ctx, env, "on");
  expect(d.allowed?.("sweeps", coin())).toBe(true);
  expect(d.allowed?.("sweeps", coin({ hold: "review" }))).toBe(false);
  expect(d.allowed?.("buybackBurn", null)).toBe(true);
  m.off.add("sweeps");
  expect(d.allowed?.("sweeps", coin())).toBe(false);
  expect(d.allowed?.("finalize", coin())).toBe(true);
});
