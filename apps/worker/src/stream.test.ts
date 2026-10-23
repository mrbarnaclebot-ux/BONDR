// The stream's pure parts and the gap fill against a fake connection. The socket never opens in Vitest
// (Pitfall 1: a test must not keep a Neon branch awake).
import type { Connection } from "@solana/web3.js";
import { expect, test } from "vitest";
import { gapFill } from "./ingest.ts";
import { backoff, isPumpInvoke, shouldIngest } from "./stream.ts";

const PUMP = "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [2]";
const AMM = "Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA invoke [1]";
const TRANSFER = [
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [1]",
  "Program log: Instruction: TransferChecked",
  "Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success",
];

test("isPumpInvoke: a pump or PumpSwap invoke, or truncated logs; not a plain transfer", () => {
  expect(isPumpInvoke([...TRANSFER, PUMP])).toBe(true);
  expect(isPumpInvoke([AMM])).toBe(true);
  expect(isPumpInvoke([...TRANSFER, "Log truncated"])).toBe(true);
  expect(isPumpInvoke(TRANSFER)).toBe(false);
  expect(isPumpInvoke([`Program log: ${PUMP}`])).toBe(false);
});

test("shouldIngest: failed txs are skipped", () => {
  expect(shouldIngest({ err: {}, logs: [PUMP] })).toBe(false);
  expect(shouldIngest({ err: null, logs: [PUMP] })).toBe(true);
  expect(shouldIngest({ err: null, logs: TRANSFER })).toBe(false);
});

test("backoff: about 1 s growing to a 30 s cap, jitter within 20 percent", () => {
  for (const r of [0, 0.5, 0.999]) {
    expect(backoff(0, r)).toBeGreaterThanOrEqual(800);
    expect(backoff(0, r)).toBeLessThanOrEqual(1200);
    expect(backoff(20, r)).toBeGreaterThanOrEqual(24_000);
    expect(backoff(20, r)).toBeLessThanOrEqual(36_000);
  }
  expect(backoff(3, 0.5)).toBe(8000);
  expect(backoff(10, 0.5)).toBe(30_000);
});

test("gapFill pages back to last_sig, then ingests oldest first and skips failed txs", async () => {
  // Newest first, as getSignaturesForAddress returns them; pages of 1000.
  const all = Array.from({ length: 1002 }, (_, i) => ({
    signature: `s${1001 - i}`,
    err: i === 1 ? {} : null,
  }));
  const calls: { until?: string; before?: string; limit?: number }[] = [];
  const conn = {
    getSignaturesForAddress: async (_: unknown, o: { until?: string; before?: string; limit?: number }) => {
      calls.push(o);
      const from = o.before ? all.findIndex((s) => s.signature === o.before) + 1 : 0;
      return all.slice(from, from + (o.limit ?? 1000));
    },
  } as unknown as Connection;
  const seen: string[] = [];
  const n = await gapFill(conn, "11111111111111111111111111111111", "s-last", async (_c, sig) => {
    seen.push(sig);
    return [];
  });
  expect(calls.map((c) => [c.until, c.before, c.limit])).toEqual([
    ["s-last", undefined, 1000],
    ["s-last", "s2", 1000],
  ]);
  expect(n).toBe(1001);
  expect(seen[0]).toBe("s0");
  expect(seen.at(-1)).toBe("s1001");
  expect(seen).not.toContain("s1000");
});
