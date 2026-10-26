import type { AdminBalances, AdminCoinLive } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import { actionStates } from "./admin-applies";
import type { WRow } from "./admin-data";
import { wState } from "./admin-state";
import type { CoinTimeline, TimelineRow } from "./admin-timeline";

const NOW = Date.parse("2026-10-25T12:00:00Z");
const row = (over: Partial<WRow> = {}): WRow => ({
  ...{ mint: "M", symbol: "SWMP", name: "Swamp", image: null, w: "W1111", venue: "curve" },
  ...{ finalize: "none", feeBudget: "0", feesUnclaimed: "0", cost: "1000", bondrSol: null },
  ...{ launchedAt: new Date(NOW - 3_600_000).toISOString(), lastCollectAt: null, heldAt: null },
  ...{ heldReason: null, bondSent: false, bondedAt: null, launch: "landed" },
  ...over,
});
const live = (tokens: string): AdminCoinLive => ({
  ...{ mint: "M", w: "W1111", sol: "0", bondr: "0", tokens, windowIndex: 0, windowEndsAt: NOW },
  memory: { mint: "M", stuck: null, hold: null, busy: false },
});
const sweep = (state: TimelineRow["state"], windowIndex = 0): TimelineRow => ({
  ...{ kind: "sweep_buyback", state, amount: "1", burned: null, sol: null, signature: "S", windowIndex },
  ...{ detail: null, createdAt: new Date(NOW).toISOString(), landedAt: null },
});
const tl = (rows: TimelineRow[] = []): CoinTimeline => ({ launch: null, rows });
const bal = (buybackBondr: string) => ({ buybackBondr }) as AdminBalances;

const H4 = 4 * 3_600_000;
type Opts = { live?: AdminCoinLive; rows?: TimelineRow[]; buyback?: string };
const statesOf = (r: WRow, opts: Opts = {}) =>
  actionStates({
    row: r,
    state: wState(r, undefined, NOW, H4),
    live: opts.live ?? null,
    timeline: tl(opts.rows),
    balances: opts.buyback === undefined ? null : bal(opts.buyback),
    ...{ now: NOW, windowMs: H4 },
  });

function applying(r: WRow, opts: Opts = {}) {
  return Object.entries(statesOf(r, opts))
    .filter(([, s]) => s.applies)
    .map(([k]) => k)
    .sort();
}

test("a curve coin: sweep now and hold; forced bond only at the trigger", () => {
  expect(applying(row())).toEqual(["hold", "sweep_now"]);
  expect(applying(row({ feeBudget: "1050" }))).toEqual(["hold", "retry_forced_bond", "sweep_now"]);
  expect(applying(row({ feeBudget: "1049" }))).not.toContain("retry_forced_bond");
});

test("burn W tokens follows the live child balance", () => {
  expect(applying(row(), { live: live("5") })).toContain("burn_w_tokens");
  expect(applying(row(), { live: live("0") })).not.toContain("burn_w_tokens");
  expect(applying(row())).not.toContain("burn_w_tokens");
});

test("complete, bonded, held finalize and finalized", () => {
  expect(applying(row({ venue: "complete" }))).toEqual(["hold", "run_migrate"]);
  expect(applying(row({ venue: "pool" }))).toEqual(["finalize_split", "hold"]);
  const held = row({ venue: "pool", finalize: "held" });
  expect(applying(held)).toEqual(["finalize_split", "release_hold"]);
  expect(applying(row({ venue: "pool", finalize: "done" }))).toEqual([
    "distribute_now",
    "hold",
    "sweep_leftovers",
  ]);
});

test("retry sweep needs a failed or expired sweep with no live twin", () => {
  expect(applying(row(), { rows: [sweep("failed")] })).toContain("retry_sweep");
  expect(applying(row(), { rows: [sweep("expired", 2)] })).toContain("retry_sweep");
  expect(applying(row(), { rows: [sweep("failed"), sweep("landed")] })).not.toContain("retry_sweep");
  expect(applying(row(), { rows: [sweep("landed")] })).not.toContain("retry_sweep");
});

test("hold and release toggle with the held flag; re-check only for an unconfirmed launch", () => {
  expect(applying(row({ heldAt: new Date(NOW).toISOString() }))).toEqual(["release_hold", "sweep_now"]);
  expect(applying(row({ launch: "unconfirmed", cost: null }))).toEqual(["recheck_launch"]);
});

test("burn buyback needs BONDR in the buyback wallet", () => {
  expect(applying(row(), { buyback: "1" })).toContain("burn_buyback");
  expect(applying(row(), { buyback: "0" })).not.toContain("burn_buyback");
});

test("a reason is the filled copy when the action does not apply, empty when it does", () => {
  const r = row();
  const s = actionStates({
    row: r,
    state: wState(r, undefined, NOW, 1),
    live: null,
    timeline: tl(),
    balances: null,
    ...{ now: NOW, windowMs: 1 },
  });
  expect(s.burn_w_tokens.reason).toBe(
    "Burn W token balance applies only when this coin's W holds SWMP tokens.",
  );
  expect(s.sweep_now.reason).toBe("");
});

test("sweep now greys with the next window's time once the current window has a live sweep", () => {
  expect(applying(row(), { rows: [sweep("landed")] })).not.toContain("sweep_now");
  expect(applying(row(), { rows: [sweep("pending")] })).not.toContain("sweep_now");
  expect(applying(row(), { rows: [sweep("landed", 1), sweep("failed")] })).toContain("sweep_now");
  expect(statesOf(row(), { rows: [sweep("landed")] }).sweep_now.reason).toBe(
    "Already swept this window. The next window opens in 3h 0m.",
  );
  expect(statesOf(row({ venue: "pool" }), { rows: [sweep("landed")] }).sweep_now.reason).toBe(
    "Sweep now applies only to a coin still on its curve.",
  );
});
