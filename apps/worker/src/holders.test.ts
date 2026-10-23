import type { Connection } from "@solana/web3.js";
import { afterEach, expect, test, vi } from "vitest";
import { countHolders, INCINERATOR, schedule, touch } from "./holders.ts";

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

test("schedule: now when never counted or counted 5 min ago, else 5 min after the last count", () => {
  const now = 100 * MIN;
  expect(schedule(undefined, now)).toBe(now);
  expect(schedule(now - 5 * MIN, now)).toBe(now);
  expect(schedule(now - 6 * MIN, now)).toBe(now);
  expect(schedule(now - 2 * MIN, now)).toBe(now + 3 * MIN);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

test("touch: a second trade while a recount is pending arms nothing", () => {
  vi.useFakeTimers();
  const coin = { mint: "m", bondingCurve: "c", pool: "p", initialRealTokenReserves: "1" };
  const conn = {} as Connection;
  touch(conn, coin);
  touch(conn, coin);
  touch(conn, coin);
  expect(vi.getTimerCount()).toBe(1);
});
