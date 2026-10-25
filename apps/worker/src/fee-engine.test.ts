// The engine's schedule, ready gate and per-coin queue with fake timers and fake deps. No RPC, no Postgres.
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { type CoinLoad, Engine } from "./fee-engine.ts";
import { windowJob } from "./fee-prebond.ts";
import type { FeeDeps } from "./fee-send.ts";

vi.mock("./fee-prebond.ts", () => ({ windowJob: vi.fn(async () => []), splitJob: vi.fn() }));
const run = vi.mocked(windowJob);

const keys = new Map<string, Keypair>();
const wOf = (mint: string) => keys.get(mint) ?? keys.set(mint, Keypair.generate()).get(mint)!;
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
