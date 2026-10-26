// Which recovery actions apply to a coin now (ADMIN-03, D-16): the worker's applies() rules in admin-actions.ts
// and admin-act.ts, read from what the console already has. T-06-17-04: this only greys buttons; the worker
// re-checks at simulate and execute. Pure, so the unit test pins every rule.
import type { AdminBalances, AdminCoinLive } from "@bondr/core/api-admin";
import { windowOf } from "@bondr/core/fees";
import { ACTION_COPY, type ActionKey, fill, sweptCopy } from "./admin-copy-actions";
import type { WRow } from "./admin-data";
import { triggerReady, type WState, windowMsLeft } from "./admin-state";
import type { CoinTimeline, TimelineRow } from "./admin-timeline";
import { windowLeft } from "./format";

export type { ActionKey } from "./admin-copy-actions";
export type GridKey = Exclude<ActionKey, "evacuate">;
export type ActionState = { applies: boolean; reason: string };

type Input = {
  row: WRow;
  state: WState;
  live: AdminCoinLive | null;
  timeline: CoinTimeline;
  balances: AdminBalances | null;
  now: number;
  windowMs: number;
};

const SWEEP = new Set(["sweep_buyback", "sweep_treasury"]);
const isSweep = (r: TimelineRow) => SWEEP.has(r.kind);

// fee-ledger failedSweep: a failed or expired sweep whose kind and window have no pending or landed twin.
function failedSweep(rows: TimelineRow[]): boolean {
  const live = rows.filter((r) => isSweep(r) && (r.state === "pending" || r.state === "landed"));
  return rows.some(
    (r) =>
      isSweep(r) &&
      (r.state === "failed" || r.state === "expired") &&
      !live.some((l) => l.kind === r.kind && l.windowIndex === r.windowIndex),
  );
}

// fee-ledger has(): a pending or landed sweep in the coin's current window; the DB allows one per window.
function windowSwept({ row, timeline, now, windowMs }: Input): boolean {
  const i = windowOf(Date.parse(row.launchedAt), now, windowMs);
  const live = (r: TimelineRow) => r.state === "pending" || r.state === "landed";
  return timeline.rows.some((r) => isSweep(r) && live(r) && r.windowIndex === i);
}

/** Whether the coin is held: a manual hold, a finalize deployer hold or a hold the engine has in memory. */
export const isHeld = (row: WRow, state: WState): boolean =>
  !!row.heldAt || row.finalize === "held" || state.key === "held";

function rules({ row, state, live, timeline, balances }: Input, swept: boolean): Record<GridKey, boolean> {
  const coin = row.launch === "landed"; // an unconfirmed launch has no coin row yet
  const curve = coin && row.venue === "curve";
  const finalized = coin && row.finalize === "done";
  const held = isHeld(row, state);
  return {
    sweep_now: curve && !swept,
    retry_forced_bond: curve && triggerReady(row),
    burn_w_tokens: coin && live !== null && BigInt(live.tokens) > 0n,
    run_migrate: coin && row.venue === "complete",
    finalize_split: coin && row.venue === "pool" && row.finalize !== "done",
    retry_sweep: coin && failedSweep(timeline.rows),
    distribute_now: finalized,
    sweep_leftovers: finalized,
    burn_buyback: balances !== null && BigInt(balances.buybackBondr) > 0n,
    hold: coin && !held, // the worker's hold needs the coin row (WR-B-06)
    release_hold: coin && held,
    recheck_launch: row.launch === "unconfirmed",
  };
}

/** Each grid action's applicability and, when it does not apply, its reason with the symbol filled in. */
export function actionStates(input: Input): Record<GridKey, ActionState> {
  const { row, now, windowMs } = input;
  const swept = row.venue === "curve" && windowSwept(input);
  const on = rules(input, swept);
  const reason = (k: GridKey) =>
    k === "sweep_now" && swept
      ? sweptCopy(windowLeft(windowMsLeft(row, now, windowMs)))
      : fill(ACTION_COPY[k].reason, row.symbol);
  const keys = Object.keys(on) as GridKey[];
  return Object.fromEntries(
    keys.map((k) => [k, { applies: on[k], reason: on[k] ? "" : reason(k) }]),
  ) as Record<GridKey, ActionState>;
}
