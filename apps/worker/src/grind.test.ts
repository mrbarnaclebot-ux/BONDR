// Refill targets per lane (D-11, D-30): production must hold at least 100 free mints for child launches to open.
import { expect, test } from "vitest";
import { refillNeed } from "./grind.ts";

test("production refills to 150 below 100; local and staging to 20 below 10", () => {
  expect(refillNeed("production", 99)).toBe(51);
  expect(refillNeed("production", 100)).toBe(0);
  expect(refillNeed("staging", 9)).toBe(11);
  expect(refillNeed("local", 10)).toBe(0);
});
