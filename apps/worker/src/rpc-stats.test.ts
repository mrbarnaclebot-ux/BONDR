// The RPC ring (D-26): latency percentiles, errors and 429s over the last hour, all in memory.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

let m: typeof import("./rpc-stats.ts");
beforeEach(async () => {
  vi.resetModules();
  m = await import("./rpc-stats.ts");
});
afterEach(() => vi.unstubAllGlobals());

test("p50 and p95 over five samples; no samples gives nulls", () => {
  expect(m.rpcStats()).toEqual({ p50: null, p95: null, errorRate: 0, rateLimited: 0, count: 0 });
  for (const ms of [40, 10, 100, 30, 20]) m.note(200, ms, 1000);
  expect(m.rpcStats(1000)).toEqual({ p50: 30, p95: 100, errorRate: 0, rateLimited: 0, count: 5 });
});

test("a sample older than an hour is dropped on the next insert and not counted", () => {
  m.note(200, 10, 0);
  expect(m.rpcStats(3_600_001).count).toBe(0);
  m.note(200, 20, 3_600_001);
  expect(m.rpcStats(3_600_001)).toMatchObject({ count: 1, p50: 20 });
});

test("the ring never exceeds 50,000 entries", () => {
  for (let i = 0; i < 50_010; i++) m.note(200, 1, 5);
  expect(m.rpcStats(5).count).toBe(50_000);
});

test("429 counts as rate limited and an error; a thrown fetch is an error and rethrows; 200 is not", async () => {
  const replies = [200, 429];
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const s = replies.shift();
      if (s === undefined) throw new Error("socket hang up");
      return new Response(null, { status: s });
    }),
  );
  expect((await m.timedFetch("http://rpc")).status).toBe(200);
  expect((await m.timedFetch("http://rpc")).status).toBe(429);
  await expect(m.timedFetch("http://rpc")).rejects.toThrow("socket hang up");
  expect(m.rpcStats()).toMatchObject({ count: 3, rateLimited: 1, errorRate: 2 / 3 });
});
