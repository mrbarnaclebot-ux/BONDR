import type { Connection } from "@solana/web3.js";
import { afterEach, expect, test, vi } from "vitest";
import { countHolders, due, INCINERATOR, touch } from "./holders.ts";

const MIN = 60_000;

test("countHolders: positive balances, one per owner, never the curve, the pool or the incinerator", () => {
  const exclude = new Set(["curve", "pool", INCINERATOR]);
  const accounts = [
    { owner: "a", amount: 5n },
    { owner: "a", amount: 1n },
    { owner: "b", amount: 0n },
    { owner: "c", amount: 1n },
    { owner: "curve", amount: 10n ** 15n },
    { owner: "pool", amount: 10n ** 14n },
    { owner: INCINERATOR, amount: 7n },
  ];
  expect(countHolders(accounts, exclude)).toBe(2);
  expect(countHolders([], exclude)).toBe(0);
});

test("due: when never counted or counted 5 min ago or more, never inside the window", () => {
  const now = 100 * MIN;
  expect(due(undefined, now)).toBe(true);
  expect(due(now - 5 * MIN, now)).toBe(true);
  expect(due(now - 6 * MIN, now)).toBe(true);
  expect(due(now - 2 * MIN, now)).toBe(false);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("touch: the first trade recounts at once, trades inside 5 min recount nothing and arm no timer", async () => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const coin = { mint: "m", bondingCurve: "c", pool: "p", initialRealTokenReserves: "1" };
  const reads = vi.fn(async () => {
    throw new Error("rpc down"); // stops before the database write
  });
  const conn = { getProgramAccounts: reads } as unknown as Connection;
  touch(conn, coin);
  touch(conn, coin);
  vi.advanceTimersByTime(4 * MIN);
  touch(conn, coin);
  expect(reads).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(MIN);
  touch(conn, coin);
  expect(reads).toHaveBeenCalledTimes(2);
});
