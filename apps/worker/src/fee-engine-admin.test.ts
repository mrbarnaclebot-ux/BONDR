// The admin controls on the engine: stuck memory, exclusive runs, idle waits and the manual hold. No RPC, no
// Postgres (the boot read runs against a fake query chain).

import { derive } from "@bondr/core/keys";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { WorkerEnv } from "./env.ts";
import { loadCoin, startEngine } from "./fee-boot.ts";
import { type CoinLoad, Engine, STUCK_AT } from "./fee-engine.ts";
import type { FeeDeps, Landed } from "./fee-send.ts";

const q = vi.hoisted(() => ({ fields: {} as Record<string, unknown>, rows: [] as unknown[] }));
vi.mock("@bondr/core/db", async (orig) => ({
  ...((await orig()) as object),
  db: () => ({
    select: (f: Record<string, unknown>) => {
      q.fields = f;
      return { from: () => ({ innerJoin: () => ({ where: async () => q.rows }) }) };
    },
  }),
}));

const keys = new Map<string, Keypair>();
function wOf(mint: string): Keypair {
  if (!keys.has(mint)) keys.set(mint, Keypair.generate());
  return keys.get(mint) as Keypair;
}
const A = Keypair.generate().publicKey.toBase58();
const B = Keypair.generate().publicKey.toBase58();
const row = (o: Partial<CoinLoad> = {}): CoinLoad => ({
  ...{ mint: A, w: wOf(o.mint ?? A).publicKey.toBase58(), launchSig: "sig", wallet: A },
  ...{ launchedAt: 0, venue: "curve", feeBudget: "0", feesUnclaimed: "0", cost: null, finalize: "none" },
  ...o,
});
const engine = (mode: "off" | "dry" | "on" = "on") =>
  new Engine({ mode, deps: {} as FeeDeps, windowMs: 1000, wOf });
const deferred = () => {
  let resolve = () => {};
  const p = new Promise<void>((r) => {
    resolve = r;
  });
  return { p, resolve };
};
const landed = (state: Landed["state"]): Landed[] => [{ state }];
const boom = async () => {
  throw new Error("Simulation failed: 0x1771 at https://rpc.example/?api-key=SECRET");
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(5000);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("three rejections mark the coin stuck with its step, attempts, a short code and the time", async () => {
  const e = engine();
  e.add(row());
  for (let i = 0; i < 3; i++) await e.enqueue(A, boom, `fee finalize ${A}`);
  expect(STUCK_AT).toBe(3);
  const [m] = e.memory();
  expect(m).toEqual({
    mint: A,
    stuck: { step: "finalize", attempts: 3, code: "simulation_failed", at: 5000 },
    hold: null,
    busy: false,
  });
  expect(JSON.stringify(m)).not.toContain("SECRET");
  expect(e.stuckCount()).toEqual({ count: 1, first: { mint: A, step: "finalize", attempts: 3 } });
});

test("the step name comes from the job label", async () => {
  const e = engine();
  e.add(row());
  const steps = {
    "forced bond": `forced bond ${A}`,
    sweep: `fee window ${A} 4`,
    distribute: `fee distribute ${A}`,
  };
  for (const [step, what] of Object.entries(steps)) {
    for (let i = 0; i < 3; i++) await e.enqueue(A, boom, what);
    expect(e.memory().find((m) => m.mint === A)?.stuck?.step).toBe(step);
  }
});

test("two failures are not stuck; a restart has no failures", async () => {
  const e = engine();
  e.add(row());
  await e.enqueue(A, boom, `fee finalize ${A}`);
  await e.enqueue(A, async () => landed("failed"), `fee finalize ${A}`);
  expect(e.memory()[0]?.stuck).toBeNull();
  expect(e.stuckCount()).toEqual({ count: 0, first: null });
  const fresh = engine();
  fresh.add(row());
  expect(fresh.memory()[0]?.stuck).toBeNull();
});

test("a failed Landed counts as a failure and a landed one clears the coin", async () => {
  const e = engine();
  e.add(row());
  for (let i = 0; i < 3; i++) await e.enqueue(A, async () => landed("failed"), `fee window ${A} ${i}`);
  expect(e.memory()[0]?.stuck).toMatchObject({ step: "sweep", attempts: 3, code: "send_failed" });
  await e.enqueue(A, async () => landed("skipped"), `fee window ${A} 3`);
  expect(e.stuckCount().count).toBe(1);
  await e.enqueue(A, async () => [{ state: "dry" }, { state: "landed" }] as Landed[], `fee window ${A} 4`);
  expect(e.memory()[0]?.stuck).toBeNull();
});

test("exclusive returns the job's value with the engine off", async () => {
  expect(await engine("off").exclusive(A, async () => 42)).toBe(42);
});

test("exclusive waits for a queued job, rethrows to the caller and the next job still runs", async () => {
  const e = engine();
  const log: string[] = [];
  const gate = deferred();
  void e.enqueue(A, async () => {
    await gate.p;
    log.push("auto");
  });
  const admin = e.exclusive(A, async () => {
    log.push("admin");
    return "out";
  });
  const bad = e.exclusive(A, boom);
  const after = e.enqueue(A, async () => void log.push("next"));
  expect(e.memory()).toEqual([]); // no coin loaded, busy is only reported for engine coins
  expect(e.busy(A)).toBe(true);
  gate.resolve();
  expect(await admin).toBe("out");
  await expect(bad).rejects.toThrow("Simulation failed");
  await after;
  expect(log).toEqual(["auto", "admin", "next"]);
  expect(e.busy(A)).toBe(false);
});

test("an owner run never counts a failure; only the stuck step landing clears it (WR-W-09)", async () => {
  const e = engine();
  e.add(row());
  for (let i = 0; i < 3; i++) await e.enqueue(A, boom, `forced bond ${A}`);
  expect(e.memory()[0]?.stuck).toMatchObject({ step: "forced bond", attempts: 3 });
  await e.exclusive(A, boom, `forced bond ${A}`).catch(() => {});
  await e.exclusive(A, boom).catch(() => {});
  expect(e.memory()[0]?.stuck).toMatchObject({ step: "forced bond", attempts: 3 });
  await e.enqueue(A, async () => landed("landed"), `fee window ${A} 2`); // another step landing
  await e.exclusive(A, async () => landed("landed")); // Burn W token balance
  expect(e.memory()[0]?.stuck).toMatchObject({ step: "forced bond", attempts: 3 });
  expect(await e.exclusive(A, async () => landed("landed"), `forced bond ${A}`)).toEqual(landed("landed"));
  expect(e.memory()[0]?.stuck).toBeNull();
});

test("idle resolves only after the jobs queued on each mint at call time settle", async () => {
  const e = engine();
  const [a, b] = [deferred(), deferred()];
  void e.enqueue(A, () => a.p);
  void e.enqueue(B, () => b.p);
  let done = false;
  const wait = e.idle([A, B, "none"]).then(() => {
    done = true;
  });
  a.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(done).toBe(false);
  b.resolve();
  await wait;
  expect(done).toBe(true);
});

test("setHold sets and clears the manual hold; a reset moves finalize held to none only", () => {
  const e = engine();
  e.add(row({ finalize: "held" }));
  e.add(row({ mint: B, finalize: "done" }));
  e.setHold(A, "review");
  expect(e.coin(A)?.hold).toBe("review");
  expect(e.memory().find((m) => m.mint === A)?.hold).toBe("review");
  e.setHold(A, null, true);
  expect(e.coin(A)?.hold).toBeUndefined();
  expect(e.coin(A)?.finalize).toBe("none");
  e.setHold(B, "x");
  e.setHold(B, null, true);
  expect(e.coin(B)?.finalize).toBe("done"); // Pitfall 13: a finalized coin stays finalized
  e.setHold("missing", "x");
  expect(e.coin("missing")).toBeUndefined();
});

test("the boot read loads held_reason into hold, and loadCoin reads one mint", async () => {
  const seed = Buffer.alloc(32, 7);
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await startEngine(
    { Q: Keypair.generate().publicKey } as never,
    { feeEngine: "off", seed, net: "devnet" } as WorkerEnv,
  );
  log.mockRestore();
  const w = derive(seed, "w", "devnet", A).publicKey.toBase58();
  q.rows = [row({ w, heldReason: "review" })];
  const coin = await loadCoin(A);
  expect(Object.keys(q.fields)).toContain("heldReason");
  expect(coin?.hold).toBe("review");
  expect(coin?.w.publicKey.toBase58()).toBe(w);
  q.rows = [row({ w, heldReason: null })];
  expect((await loadCoin(A))?.hold).toBeUndefined();
  q.rows = [];
  expect(await loadCoin(A)).toBeUndefined();
});
