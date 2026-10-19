import { expect, test } from "vitest";
import { applyBps, split90_10 } from "./math.ts";

test("applyBps floors x * bps / 10000", () => {
  expect(applyBps(1000n, 9900)).toBe(990n);
  expect(applyBps(0n, 9900)).toBe(0n);
  expect(applyBps(999n, 9900)).toBe(989n); // 989.01 floors
});

test("applyBps never exceeds x for bps up to 10000", () => {
  for (const x of [1n, 7n, 123_456_789n, 10n ** 18n])
    for (const b of [0, 1, 9800, 9900, 9999, 10_000]) expect(applyBps(x, b) <= x).toBe(true);
});

test("applyBps rejects bps outside 0..10000 and negative amounts", () => {
  expect(() => applyBps(1n, 10_001)).toThrow();
  expect(() => applyBps(1n, -1)).toThrow();
  expect(() => applyBps(1n, 1.5)).toThrow();
  expect(() => applyBps(-1n, 100)).toThrow();
});

test("exact-out margins: qMin never exceeds qOut and amount never exceeds childOut", () => {
  // A large token amount, the smallest amount, and values where flooring bites.
  for (const [qOut, childOut] of [
    [8_887_102_448_093n, 34_517_239_812_117n],
    [1n, 1n],
    [101n, 99n],
  ]) {
    const qMin = applyBps(qOut, 9900);
    const amount = applyBps(childOut, 9800);
    expect(qMin <= qOut && qMin >= (qOut * 99n) / 100n).toBe(true);
    expect(amount <= childOut && amount >= (childOut * 98n) / 100n).toBe(true);
  }
});

test("split90_10 floors the treasury tenth and gives the remainder to burn", () => {
  expect(split90_10(100n)).toEqual({ treasury: 10n, burn: 90n });
  expect(split90_10(99n)).toEqual({ treasury: 9n, burn: 90n });
  for (const x of [0n, 1n, 9n, 10n, 123_456_789n]) {
    const { treasury, burn } = split90_10(x);
    expect(treasury + burn).toBe(x);
  }
});
