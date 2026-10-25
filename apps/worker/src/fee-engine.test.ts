// The engine's schedule, ready gate and per-coin queue with fake timers and fake deps. No RPC, no Postgres.

import { costFromReserves } from "@bondr/core/curve";
import { derive } from "@bondr/core/keys";
import type { Parsed } from "@bondr/core/trades";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorkerEnv } from "./env.ts";
import { bondedJob, forcedJob } from "./fee-burns.ts";
import { type CoinLoad, Engine, startEngine, withCost } from "./fee-engine.ts";
import { windowJob } from "./fee-prebond.ts";
import type { FeeDeps } from "./fee-send.ts";

vi.mock("./fee-prebond.ts", () => ({ windowJob: vi.fn(async () => []), splitJob: vi.fn() }));
vi.mock("./fee-burns.ts", () => ({ forcedJob: vi.fn(async () => []), bondedJob: vi.fn(async () => []) }));
vi.mock("./trade-state.ts", () => ({ configs: async () => ({ global: "g", feeConfig: "fc" }) }));
vi.mock("@bondr/core/curve", () => ({ costFromReserves: vi.fn(() => 123n) }));
const run = vi.mocked(windowJob);
const forced = vi.mocked(forcedJob);
const bonded = vi.mocked(bondedJob);

const keys = new Map<string, Keypair>();
function wOf(mint: string): Keypair {
  if (!keys.has(mint)) keys.set(mint, Keypair.generate());
  return keys.get(mint) as Keypair;
}
const MINT = Keypair.generate().publicKey.toBase58();
const row = (o: Partial<CoinLoad> = {}): CoinLoad => ({
  ...{ mint: MINT, w: wOf(o.mint ?? MINT).publicKey.toBase58(), launchSig: "sig", wallet: MINT },
  ...{ launchedAt: 0, venue: "curve", feeBudget: "0", feesUnclaimed: "0", cost: null, finalize: "none" },
  ...o,
});
const deps = {} as FeeDeps;
const engine = (mode: "off" | "dry" | "on" = "on") => new Engine({ mode, deps, windowMs: 1000, wOf });
const patch = (mint: string, o: object) => ({ patches: [{ mint, ...o }], inserted: [{ mint, slot: "5" }] });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(2500);
  run.mockClear();
  forced.mockClear();
  bonded.mockClear();
});
afterEach(() => vi.useRealTimers());

test("mode off: hooks and timers do nothing and no deps are called", async () => {
  const e = engine("off");
  e.add(row());
  e.onIngest({ ...patch(MINT, { feesUnclaimed: "9" }), launched: launched("x") });
  expect(e.start()).toBe(0);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
  expect(run).not.toHaveBeenCalled();
  expect(e.coins.size).toBe(0);
});

test("one timer for the current window's end, then the next; never a past window", async () => {
  const e = engine();
  e.add(row());
  expect(e.start()).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(499);
  expect(run).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(run.mock.calls.map((c) => c[2])).toEqual([2]);
  expect(run.mock.calls[0]?.[1].mint.toBase58()).toBe(MINT);
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(1000);
  expect(run.mock.calls.map((c) => c[2])).toEqual([2, 3]);
});

function launched(mint: string) {
  return { mint, launchedAt: 2000, launchSig: "l", wallet: MINT };
}

test("before ready a hook updates memory and arms nothing; after ready a launch arms its timer", async () => {
  const e = engine();
  e.add(row());
  e.onIngest(patch(MINT, { feesUnclaimed: "9", costToComplete: "77" }));
  expect(e.coins.get(MINT)).toMatchObject({ feesUnclaimed: 9n, cost: 77n });
  const early = Keypair.generate().publicKey.toBase58();
  e.onIngest({ patches: [], inserted: [], launched: launched(early) });
  expect(vi.getTimerCount()).toBe(0);
  expect(e.start()).toBe(2);
  const late = Keypair.generate().publicKey.toBase58();
  e.onIngest({ patches: [], inserted: [], launched: launched(late) });
  expect(e.coins.get(late)?.w.publicKey.toBase58()).toBe(wOf(late).publicKey.toBase58());
  expect(vi.getTimerCount()).toBe(3);
  await vi.advanceTimersByTimeAsync(500);
  expect(run.mock.calls.map((c) => [c[1].mint.toBase58(), c[2]]).sort()).toEqual(
    [MINT, early, late].map((m) => [m, m === MINT ? 2 : 0]).sort(),
  );
});

test("an older slot never moves memory back", () => {
  const e = engine();
  e.add(row());
  e.onIngest(patch(MINT, { feesUnclaimed: "9" }));
  e.onIngest({ patches: [{ mint: MINT, feesUnclaimed: "3" }], inserted: [{ mint: MINT, slot: "4" }] });
  expect(e.coins.get(MINT)?.feesUnclaimed).toBe(9n);
});

const deferred = () => {
  let resolve = () => {};
  const p = new Promise<void>((r) => {
    resolve = r;
  });
  return { p, resolve };
};

test("jobs on one mint run one after the other, a rejection is logged, two mints overlap", async () => {
  const e = engine();
  const log: string[] = [];
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const a = deferred();
  const first = e.enqueue("A", async () => {
    log.push("a1 start");
    await a.p;
    log.push("a1 end");
  });
  void e.enqueue("A", async () => {
    log.push("a2");
    throw new Error("boom");
  });
  const third = e.enqueue("A", async () => void log.push("a3"));
  await e.enqueue("B", async () => void log.push("b1"));
  expect(log).toEqual(["a1 start", "b1"]);
  a.resolve();
  await first;
  await third;
  expect(log).toEqual(["a1 start", "b1", "a1 end", "a2", "a3"]);
  expect(err).toHaveBeenCalledWith(expect.stringContaining("boom"));
  err.mockRestore();
});

test("a coin whose W does not derive from this seed is skipped with one warning", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const e = engine();
  expect(e.add(row({ w: Keypair.generate().publicKey.toBase58() }))).toBe(false);
  expect(e.start()).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(warn).toHaveBeenCalledTimes(1);
  warn.mockRestore();
});

test("a coin leaving the curve has its window timer cleared", async () => {
  const e = engine();
  e.add(row());
  e.start();
  e.onIngest({ patches: [{ mint: MINT, venue: "complete" }], inserted: [], bonded: new Set([MINT]) });
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(5000);
  expect(run).not.toHaveBeenCalled();
});

test("a landed collect zeroes the bucket and adds to the budget in memory", () => {
  const e = engine();
  e.add(row({ feesUnclaimed: "50" }));
  const base = { state: "landed", signature: "s", lastValidBlockHeight: 1n, error: null, landedAt: null };
  e.landed(MINT, [{ ...base, id: 1, kind: "collect", mint: MINT, amount: 40n } as never]);
  expect(e.coins.get(MINT)).toMatchObject({ feesUnclaimed: 0n, feeBudget: 40n });
});

test("withCost prices every curve patch with reserves, W as creator, in any mode", async () => {
  const seed = Buffer.alloc(32, 7);
  const Q = Keypair.generate().publicKey;
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await startEngine({ Q } as never, { feeEngine: "off", seed, net: "devnet" } as WorkerEnv);
  log.mockRestore();
  const r = {
    virtualTokenReserves: "1",
    virtualQuoteReserves: "2",
    realTokenReserves: "3",
    realQuoteReserves: "4",
  };
  const parsed = { patches: [{ mint: MINT, ...r }, { mint: "B", venue: "complete", ...r }, { mint: "C" }] };
  await withCost({} as never, parsed as unknown as Parsed);
  expect(parsed.patches.map((p) => (p as { costToComplete?: string }).costToComplete)).toEqual([
    "123",
    undefined,
    undefined,
  ]);
  const [, rates, ids] = vi.mocked(costFromReserves).mock.calls[0] ?? [];
  expect(rates).toEqual({ global: "g", feeConfig: "fc" });
  expect(ids?.creator.toBase58()).toBe(derive(seed, "w", "devnet", MINT).publicKey.toBase58());
  expect(ids).toMatchObject({ quoteMint: Q, creatorFeeBps: 0 });
});

test("after ready, budget plus 90% of unclaimed at 105% of the cost enqueues one forced bond", async () => {
  const e = engine();
  e.add(row({ feeBudget: "60" }));
  const hit = patch(MINT, { feesUnclaimed: "50", costToComplete: "100" }); // 60 + 45 = 105% of 100
  e.onIngest(hit);
  expect(forced).not.toHaveBeenCalled(); // before ready (gap fill, Pitfall 10)
  e.start();
  const hold = deferred();
  forced.mockImplementationOnce(async () => {
    await hold.p;
    return [];
  });
  e.onIngest(hit);
  e.onIngest(hit);
  await vi.advanceTimersByTimeAsync(0);
  expect(forced).toHaveBeenCalledTimes(1);
  expect(forced.mock.calls[0]?.[1].mint.toBase58()).toBe(MINT);
  hold.resolve();
  await vi.advanceTimersByTimeAsync(0);
  e.onIngest(patch(MINT, { feesUnclaimed: "40", costToComplete: "100" })); // 60 + 36 = 96%
  await vi.advanceTimersByTimeAsync(0);
  expect(forced).toHaveBeenCalledTimes(1);
});

test("venue pool enqueues the bonded job, venue complete enqueues nothing", async () => {
  const e = engine();
  e.add(row({ feeBudget: "500", cost: "100" }));
  e.start();
  e.onIngest({ patches: [{ mint: MINT, venue: "complete" }], inserted: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(bonded).not.toHaveBeenCalled();
  expect(forced).not.toHaveBeenCalled();
  e.onIngest({ patches: [{ mint: MINT, venue: "pool" }], inserted: [] });
  e.onIngest({ patches: [{ mint: MINT, venue: "pool" }], inserted: [] });
  await vi.advanceTimersByTimeAsync(0);
  expect(bonded).toHaveBeenCalledTimes(1);
});

test("start enqueues the bonded job for a pooled coin not yet finalized (restart catch-up)", async () => {
  const e = engine();
  const done = Keypair.generate().publicKey.toBase58();
  e.add(row({ venue: "pool" }));
  e.add(row({ mint: done, venue: "pool", finalize: "done" }));
  e.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(bonded.mock.calls.map((c) => c[1].mint.toBase58())).toEqual([MINT]);
});
