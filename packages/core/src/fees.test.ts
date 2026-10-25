import { expect, test } from "vitest";
import {
  budgetOf,
  deployerOk,
  distributeMin,
  minOutAfter,
  PUBLIC_KINDS,
  reconcileDiff,
  sweepSplit,
  totalsFor,
  windowEnd,
  windowOf,
} from "./fees.ts";

const DAY = 86_400_000;

test("windowOf counts whole windows since launch, 0 before launch", () => {
  expect(windowOf(0, DAY - 1, DAY)).toBe(0);
  expect(windowOf(0, DAY, DAY)).toBe(1);
  expect(windowOf(5000, 1000, DAY)).toBe(0);
  expect(() => windowOf(0, 1, 0)).toThrow();
});

test("windowEnd is the close of window index", () => {
  expect(windowEnd(1000, 2, 100)).toBe(1300);
  expect(windowEnd(0, 0, DAY)).toBe(DAY);
});

test("budgetOf adds the burn share of the unclaimed bucket", () => {
  expect(budgetOf(100n, 1000n)).toBe(1000n);
  expect(budgetOf(0n, 0n)).toBe(0n);
});

test("sweepSplit floors the treasury tenth and gives dust to the buyback", () => {
  expect(sweepSplit(1001n)).toEqual({ buyback: 901n, treasury: 100n });
  expect(sweepSplit(0n)).toEqual({ buyback: 0n, treasury: 0n });
});

test("minOutAfter subtracts W's balance before the buy (WR-08)", () => {
  expect(minOutAfter(5n, 105n)).toBe(100n);
  expect(minOutAfter(0n, 1n)).toBe(1n);
  expect(() => minOutAfter(5n, 5n)).toThrow();
  expect(() => minOutAfter(5n, 4n)).toThrow();
});

test("deployerOk requires the launch wallet, three distinct accounts and an on-curve deployer", () => {
  const ok = { deployer: "D", wallet: "D", treasury: "T", w: "W", platform: ["O", "B"], onCurve: true };
  expect(deployerOk(ok)).toBeNull();
  expect(deployerOk({ ...ok, wallet: "X" })).toBe("deployer is not the launch wallet");
  expect(deployerOk({ ...ok, treasury: "D" })).toBe("deployer is the treasury");
  expect(deployerOk({ ...ok, w: "D" })).toBe("deployer is the fee wallet");
  expect(deployerOk({ ...ok, w: "T" })).toBe("treasury is the fee wallet");
  expect(deployerOk({ ...ok, platform: ["O", "D"] })).toBe("deployer is a platform key");
  expect(deployerOk({ ...ok, onCurve: false })).toBe("deployer is off curve");
});

test("distributeMin is 100 times the network fee (D-19)", () => {
  expect(distributeMin(5000)).toBe(500_000n);
});

test("totalsFor maps each landed kind to its coin column changes", () => {
  const r = { amount: 10n, burned: 7n, sol: 3n };
  expect(totalsFor("collect", r)).toEqual({ add: { fee_budget: 10n }, set: { feesUnclaimed: 0n } });
  expect(totalsFor("split_treasury", r)).toEqual({
    add: { fee_budget: -10n, to_treasury: 10n, to_treasury_sol: 3n },
  });
  expect(totalsFor("sweep_buyback", r)).toEqual({
    add: { fee_budget: -10n, to_buyback: 10n, to_buyback_sol: 3n },
  });
  expect(totalsFor("sweep_treasury", r)).toEqual({
    add: { fee_budget: -10n, to_treasury: 10n, to_treasury_sol: 3n },
  });
  const bond = { add: { fee_budget: -10n, bond_spent: 10n, bond_spent_sol: 3n, bond_burned: 7n } };
  expect(totalsFor("forced_bond", r)).toEqual(bond);
  expect(totalsFor("pool_burn", r)).toEqual(bond);
  expect(totalsFor("finalize_config", { amount: 0n })).toEqual({ add: { fee_budget: 0n } });
  expect(totalsFor("finalize_update", { amount: 4n, detail: { dBps: 8000 } })).toEqual({
    add: { fee_budget: 4n },
    set: { finalize: "done", deployerBps: 8000 },
  });
  for (const k of ["buyback_burn", "reconcile_diff", "held"] as const)
    expect(totalsFor(k, r)).toEqual({ add: {} });
});

test("totalsFor splits a distribute's SOL in proportion to its two shares", () => {
  const d = { amount: 100n, sol: 50n, detail: { deployerAmount: "80", treasuryAmount: "20" } };
  expect(totalsFor("distribute", d)).toEqual({
    add: { deployer_earned: 80n, deployer_earned_sol: 40n, to_treasury: 20n, to_treasury_sol: 10n },
  });
  const noSol = totalsFor("distribute", { detail: { deployerAmount: "1", treasuryAmount: "0" } });
  expect(noSol.add).toEqual({
    deployer_earned: 1n,
    deployer_earned_sol: 0n,
    to_treasury: 0n,
    to_treasury_sol: 0n,
  });
});

test("reconcileDiff is null on a match, else chain minus implied", () => {
  expect(reconcileDiff(10n, 10n)).toBeNull();
  expect(reconcileDiff(10n, 11n)).toBe(1n);
  expect(reconcileDiff(10n, 8n)).toBe(-2n);
});

test("PUBLIC_KINDS holds the nine public kinds only", () => {
  expect(PUBLIC_KINDS).toHaveLength(9);
  for (const k of ["buyback_burn", "held", "reconcile_diff"]) expect(PUBLIC_KINDS).not.toContain(k);
  expect(new Set(PUBLIC_KINDS).size).toBe(9);
});
