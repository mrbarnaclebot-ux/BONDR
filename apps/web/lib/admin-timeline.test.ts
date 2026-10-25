import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import type { WRow } from "./admin-data";
import { type CoinTimeline, type TimelineRow, timelineSteps } from "./admin-timeline";

const H = 3_600_000;
const NOW = Date.parse("2026-10-25T12:00:00Z");
const at = (hAgo: number) => new Date(NOW - hAgo * H).toISOString();

const row = (over: Partial<WRow> = {}): WRow => ({
  ...{ mint: "M", symbol: "SWMP", name: "Swamp", image: null, w: "W1111", venue: "curve" },
  ...{ finalize: "none", feeBudget: "0", feesUnclaimed: "0", cost: "1000", bondrSol: null },
  // Launched 5h 30m ago in a 4h window: window 1 ends 2h 30m from now.
  ...{ launchedAt: at(5.5), lastCollectAt: null, heldAt: null },
  ...{ heldReason: null, bondSent: false, bondedAt: null, launch: "landed" },
  ...over,
});
const entry = (kind: TimelineRow["kind"], hAgo: number, over: Partial<TimelineRow> = {}): TimelineRow => ({
  ...{ kind, state: "landed", amount: "35444000000", burned: null, sol: null, signature: `sig-${kind}-${hAgo}` },
  ...{ windowIndex: null, detail: null, createdAt: at(hAgo), landedAt: at(hAgo) },
  ...over,
});
const launch = (over: Partial<NonNullable<CoinTimeline["launch"]>> = {}): CoinTimeline["launch"] => ({
  ...{ state: "landed", exit: "burn", solIn: "500000000", signature: "sig-launch", wallet: "Dep1111111" },
  ...{ tokens: "17200000000000", landedAt: at(5.5), createdAt: at(5.6) },
  ...over,
});
const mem = (over: Partial<AdminCoinMemory> = {}): AdminCoinMemory => ({
  ...{ mint: "M", stuck: null, hold: null, busy: false },
  ...over,
});
const steps = (t: CoinTimeline, r = row(), m?: AdminCoinMemory) => timelineSteps(t, r, m, null, NOW, 4 * H);
const titles = (t: CoinTimeline, r?: WRow, m?: AdminCoinMemory) => steps(t, r, m).map((s) => s.title);

test("a curve coin: launch, folded collect and split, then the next collect", () => {
  const t = {
    launch: launch(),
    rows: [entry("collect", 4), entry("split_treasury", 4), entry("collect", 2), entry("split_treasury", 2)],
  };
  const s = steps(t);
  expect(s.map((x) => x.title)).toEqual(["Launched, insta burn", "Collect and split, 2 runs", "Up next"]);
  expect(s[0]).toMatchObject({ state: "done", sig: "sig-launch", detail: "5h 30m ago, 17.2M SWMP burned" });
  expect(s[1]).toMatchObject({ state: "done", sig: "sig-collect-2", detail: "2h ago, 70,888 BONDR" });
  expect(s[2]).toMatchObject({ state: "next", detail: "Collect in 2h 30m", sig: null, at: null });
});

test("insta sell names the launch so", () => {
  expect(titles({ launch: launch({ exit: "sell", tokens: null }), rows: [] })[0]).toBe("Launched, insta sell");
});

test("a finalized coin lists the engine steps in time order", () => {
  const t = {
    launch: launch(),
    rows: [
      entry("forced_bond", 3, { burned: "118200000000000" }),
      entry("finalize_config", 2.5),
      entry("finalize_update", 2.4, { amount: null, detail: { dBps: 8000, tBps: 2000 } }),
      entry("distribute", 1),
      entry("reconcile_diff", 0.5, { state: null, signature: null, amount: null, detail: { diff: "-12000000" } }),
    ],
  };
  const r = row({ venue: "pool", finalize: "done", bondedAt: at(2.9) });
  const s = steps(t, r);
  expect(s.map((x) => x.title)).toEqual([
    "Launched, insta burn",
    "Forced-bond buy and burn",
    "Migrated to PumpSwap",
    "Pending fees swept",
    "create_fee_sharing_config",
    "update_fee_shares_v2",
    "Distributed post-bond fees",
    "Reconcile mismatch, -12 BONDR",
    "Up next",
  ]);
  expect(s[1].detail).toBe("3h ago, 118.2M SWMP burned");
  expect(s[5].detail).toBe("2h 24m ago, 8000 / 2000 bps");
  expect(s[8].detail).toMatch(/^Distribute in /);
});

test("sweeps show per window, a fallback burn and leftovers have their names, failed rows are left out", () => {
  const t = {
    launch: launch(),
    rows: [
      entry("sweep_buyback", 4, { windowIndex: 0 }),
      entry("sweep_treasury", 4, { windowIndex: 0 }),
      entry("sweep_buyback", 3, { windowIndex: 1, state: "failed" }),
      entry("pool_burn", 2, { burned: "1000000" }),
      entry("leftover_burn", 1, { burned: "1000000" }),
    ],
  };
  expect(titles(t)).toEqual([
    "Launched, insta burn",
    "Swept to buyback, window 1",
    "Fallback buy and burn",
    "Leftovers swept, accounts closed",
    "Up next",
  ]);
});

test("a stuck memory entry ends the timeline with a stuck step", () => {
  const m = mem({ stuck: { step: "finalize", attempts: 3, code: "blockhash_expired", at: NOW - H } });
  const s = steps({ launch: launch(), rows: [] }, row({ venue: "pool" }), m).at(-1);
  expect(s).toMatchObject({ key: "stuck", state: "stuck", title: "update_fee_shares_v2", detail: "Stuck, 3 attempts" });
});

test("a held coin ends with a held step from its hold time", () => {
  const r = row({ venue: "pool", finalize: "held", heldAt: null });
  const t = {
    launch: launch(),
    rows: [entry("held", 2, { state: null, signature: null, amount: null, detail: { reason: "deployer" } })],
  };
  const s = steps(t, r).at(-1);
  expect(s).toMatchObject({ key: "held", state: "held", detail: "Held 2h ago" });
  const manual = steps({ launch: launch(), rows: [] }, row({ heldAt: at(1), heldReason: "review" })).at(-1);
  expect(manual).toMatchObject({ state: "held", detail: "Held 1h ago" });
});

test("an unconfirmed launch is the only step and asks for a re-check", () => {
  const t = { launch: launch({ state: "sent", landedAt: null, tokens: null }), rows: [] };
  const s = steps(t, row({ launch: "unconfirmed", cost: null }));
  expect(s).toHaveLength(1);
  expect(s[0]).toMatchObject({ key: "launch", state: "next", detail: "Re-check launch", sig: "sig-launch" });
});
