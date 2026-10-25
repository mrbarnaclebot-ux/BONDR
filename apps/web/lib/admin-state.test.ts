import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import type { WRow } from "./admin-data";
import { budgetSol, chipCounts, firstStuck, sortRows, type WItem, wItems, wState } from "./admin-state";

const H = 3_600_000;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const WIN = 4 * H;

const row = (over: Partial<WRow> = {}): WRow => ({
  ...{ mint: "M", symbol: "SWMP", name: "Swamp", image: null, w: "W1111", venue: "curve" },
  ...{ finalize: "none", feeBudget: "0", feesUnclaimed: "0", cost: "1000", bondrSol: null },
  // Launched 5h 30m ago: window 1 ends 2h 30m from now.
  ...{ launchedAt: new Date(NOW - 5.5 * H).toISOString(), lastCollectAt: null, heldAt: null },
  ...{ heldReason: null, bondSent: false, bondedAt: null, launch: "landed" },
  ...over,
});
const mem = (over: Partial<AdminCoinMemory> = {}): AdminCoinMemory => ({
  ...{ mint: "M", stuck: null, hold: null, busy: false },
  ...over,
});
const stuck = (step: string) => mem({ stuck: { step, attempts: 3, code: "job_error", at: NOW } });
const of = (r: WRow, m?: AdminCoinMemory) => wState(r, m, NOW, WIN);

test("a stuck step reads as stuck, danger, with its retry", () => {
  expect(of(row(), stuck("finalize"))).toEqual({
    ...{ key: "stuck", label: "Finalize stuck", tone: "danger", chip: "Stuck" },
    ...{ next: "Retry finalize split", stuckStep: "finalize" },
  });
  expect(of(row(), stuck("forced bond")).label).toBe("Forced bond stuck");
  expect(of(row(), stuck("forcedBond")).label).toBe("Forced bond stuck");
  expect(of(row(), stuck("sweep"))).toMatchObject({ label: "Sweep stuck", next: "Retry sweep" });
  expect(of(row(), stuck("distribute"))).toMatchObject({ label: "Distribute stuck", next: "Distribute now" });
  expect(of(row(), stuck("bonded"))).toMatchObject({ label: "Bonded stuck", next: "Retry bonded" });
});

test("an unconfirmed launch is stuck with a re-check", () => {
  expect(of(row({ launch: "unconfirmed", cost: null }))).toMatchObject({
    ...{ key: "unconfirmed", label: "Launch unconfirmed", tone: "danger", chip: "Stuck" },
    next: "Re-check launch",
  });
});

test("held from the coin row, a held finalize or a memory hold", () => {
  const held = { key: "held", label: "Held", tone: "warn", chip: "Held" };
  expect(of(row({ heldAt: "2026-10-25T10:00:00Z", heldReason: "odd deployer" }))).toMatchObject({
    ...held,
    next: "Held: odd deployer",
  });
  expect(of(row({ venue: "pool", finalize: "held" }))).toMatchObject(held);
  expect(of(row(), mem({ hold: "owner review" }))).toMatchObject({ ...held, next: "Held: owner review" });
});

test("the bond path states", () => {
  expect(of(row({ bondSent: true }))).toMatchObject({ key: "bondSent", label: "Bond sent", tone: "mint" });
  expect(of(row({ bondSent: true })).chip).toBeNull();
  expect(of(row({ venue: "complete" }))).toMatchObject({ label: "Awaiting migration", chip: null });
  expect(of(row({ venue: "pool" }))).toMatchObject({ label: "Bonded", tone: "mint", next: "Finalize next" });
  expect(of(row({ venue: "pool", finalize: "done" }))).toEqual({
    ...{ key: "finalized", label: "Finalized", tone: "leaf", chip: "Finalized" },
    ...{ next: "Distribute in 2h 30m", stuckStep: null },
  });
});

test("trigger ready at 105% of the cost, counting unclaimed fees at 90%", () => {
  expect(of(row({ feeBudget: "1050" }))).toMatchObject({
    ...{ key: "trigger", label: "Trigger ready", tone: "leaf", chip: "Trigger ready" },
    next: "Forced bond, sending",
  });
  expect(of(row({ feeBudget: "960", feesUnclaimed: "100" })).key).toBe("trigger");
  expect(of(row({ feeBudget: "1049" }))).toMatchObject({
    ...{ key: "collecting", label: "Collecting", tone: "plain", chip: "Collecting" },
    next: "Collect in 2h 30m",
  });
  expect(of(row({ feeBudget: "5", cost: null })).key).toBe("collecting");
  expect(of(row({ feeBudget: "5", cost: "0" })).key).toBe("collecting");
});

test("precedence: stuck beats held, held beats finalized", () => {
  expect(of(row({ heldAt: "2026-10-25T10:00:00Z" }), stuck("sweep")).key).toBe("stuck");
  expect(of(row({ venue: "pool", finalize: "done" }), mem({ hold: "x" })).key).toBe("held");
});

const item = (mint: string, r: Partial<WRow>, m?: AdminCoinMemory): WItem => {
  const full = row({ mint, ...r });
  return { row: full, state: of(full, m) };
};

const LIST = [
  item("fin-old", { venue: "pool", finalize: "done", bondedAt: "2026-10-20T00:00:00Z" }),
  item("col-low", { feeBudget: "100" }),
  item("fin-new", { venue: "pool", finalize: "done", bondedAt: "2026-10-24T00:00:00Z" }),
  item("bonded", { venue: "pool" }),
  item("col-high", { feeBudget: "900" }),
  item("awaiting", { venue: "complete" }),
  item("sent", { bondSent: true }),
  item("held", { heldAt: "2026-10-25T10:00:00Z" }),
  item("trigger", { feeBudget: "2000" }),
  item("col-none", { cost: null }),
  item("stuck", {}, stuck("sweep")),
  item("unconf", { launch: "unconfirmed" }),
];

test("sortRows puts what needs the owner first", () => {
  expect(sortRows(LIST).map((i) => i.row.mint)).toEqual([
    ...["stuck", "unconf", "trigger", "held", "sent", "awaiting", "bonded"],
    ...["col-high", "col-low", "col-none", "fin-new", "fin-old"],
  ]);
  expect(LIST[0].row.mint).toBe("fin-old"); // the input is not reordered
});

test("chipCounts counts All and each chip, zeros included", () => {
  expect(chipCounts(LIST)).toEqual({
    ...{ All: 12, Stuck: 2, "Trigger ready": 1, Held: 1, Collecting: 3, Finalized: 2 },
  });
  expect(chipCounts([])).toEqual({
    ...{ All: 0, Stuck: 0, "Trigger ready": 0, Held: 0, Collecting: 0, Finalized: 0 },
  });
});

test("firstStuck picks the first stuck coin in table order, else null", () => {
  expect(firstStuck(sortRows(LIST))).toBe("stuck");
  expect(firstStuck(LIST.slice(0, 3))).toBeNull();
});

test("budgetSol values the budget at the stored BONDR price", () => {
  expect(budgetSol(row({ feeBudget: "1000", feesUnclaimed: "100", bondrSol: 0.5 }))).toBe(545n);
  expect(budgetSol(row({ feeBudget: "1000" }))).toBeNull();
  expect(budgetSol(row())).toBe(0n);
});

test("wItems joins memory by mint and sorts", () => {
  const rows = [row({ mint: "a", venue: "pool", finalize: "done" }), row({ mint: "b" })];
  const out = wItems(rows, [stuck("sweep"), mem({ mint: "b", hold: "x" })], NOW, WIN);
  expect(out.map((i) => [i.row.mint, i.state.key])).toEqual([
    ["b", "held"],
    ["a", "finalized"],
  ]);
});
