import { expect, test } from "vitest";
import { EVAC_PHRASE, evacDone, evacProgress, evacSummary, phraseMatches } from "./admin-copy-evac";
import type { Part } from "./admin-copy-sim";

const text = (parts: Part[]) => parts.map((p) => `${p.pre}${p.value}${p.post ?? ""}`).join("");

test("only the exact phrase arms (D-35)", () => {
  expect(EVAC_PHRASE).toBe("EVACUATE ALL W TO TREASURY");
  expect(phraseMatches("EVACUATE ALL W TO TREASURY")).toBe(true);
  for (const near of [
    "evacuate all w to treasury",
    "EVACUATE ALL W TO  TREASURY",
    "EVACUATE ALL W TO TREASURY ",
    " EVACUATE ALL W TO TREASURY",
    "EVACUATE ALL TO TREASURY",
    "",
  ])
    expect(phraseMatches(near)).toBe(false);
});

test("the simulated totals line, numbers as display values", () => {
  const totals = {
    ...{ wallets: 214, bondr: "18402110000000", bondrSol: "9200000000" },
    ...{ sol: "410000000", burnedIn: 3, failures: 0 },
  };
  expect(text(evacSummary(totals))).toBe(
    "Simulated now: 214 W balances, 18,402,110 BONDR (9.2 SOL) and 0.41 SOL to the treasury, child tokens burned in 3 wallets, 0 failures.",
  );
});

test("the done line counts wallets moved and failed", () => {
  expect(evacDone({ moved: 12, failed: 0 })).toBe(
    "Evacuated. 12 of 12 wallets moved to the treasury, 0 failed. Every job is paused.",
  );
  expect(evacDone({ moved: 9, failed: 3 })).toBe(
    "Evacuated. 9 of 12 wallets moved to the treasury, 3 failed. Every job is paused.",
  );
  expect(evacDone({})).toBe(
    "Evacuated. 0 of 0 wallets moved to the treasury, 0 failed. Every job is paused.",
  );
});

test("progress while evacuating", () => {
  expect(evacProgress({ moved: 8, failed: 1 }, 12)).toBe("Moved 8 of 12 wallets so far, 1 failed.");
  expect(evacProgress({}, 12)).toBe(null);
});
