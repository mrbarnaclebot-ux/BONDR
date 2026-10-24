import { expect, test } from "vitest";
import { getTrade, putTrade, TRADE_MAX, TRADE_TTL_MS, updateTrade } from "./trade-store.ts";

const fields = {
  wallet: "w",
  mint: "m",
  side: "buy" as const,
  message: Buffer.from([1, 2, 3]),
  blockhash: "bh",
  lastValidBlockHeight: 100,
};

test("an entry lives until 120 s after its last update", () => {
  const e = putTrade(fields, 0);
  expect(e.id).toMatch(/^[0-9a-f]{32}$/);
  expect(e.state).toBe("prepared");
  expect(getTrade(e.id, TRADE_TTL_MS - 1)?.message).toEqual(fields.message);
  expect(updateTrade(e.id, { state: "signed" }, 100_000)?.state).toBe("signed");
  expect(getTrade(e.id, 100_000 + TRADE_TTL_MS - 1)?.state).toBe("signed");
  expect(getTrade(e.id, 100_000 + TRADE_TTL_MS)).toBeUndefined();
  expect(updateTrade(e.id, { state: "sent" }, 100_000 + TRADE_TTL_MS)).toBeUndefined();
});

test("insert sweeps expired entries and holds at most 5,000", () => {
  const old = putTrade(fields, 1_000_000);
  const t = 1_000_000 + TRADE_TTL_MS;
  const first = putTrade(fields, t);
  expect(getTrade(old.id, 0)).toBeUndefined(); // swept on insert, so even an early clock misses it
  for (let i = 1; i < TRADE_MAX; i++) putTrade(fields, t);
  expect(getTrade(first.id, t)).toBeDefined();
  putTrade(fields, t);
  expect(getTrade(first.id, t)).toBeUndefined(); // the oldest dropped at the cap
});
