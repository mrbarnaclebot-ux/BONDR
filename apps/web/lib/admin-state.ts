// The W table's per-coin state (D-20, D-24, RESEARCH Pattern 6): the coin row joined to the engine's memory in
// one pure function, so the table, its chips, its sort and the timeline's next step never disagree.
import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { budgetOf, windowEnd, windowOf } from "@bondr/core/fees";
import { trigger105 } from "@bondr/core/math";
import { toSol } from "@bondr/core/price";
import type { WRow } from "./admin-data";
import { ratio1000, windowLeft } from "./format";

export type WKey =
  | "stuck"
  | "unconfirmed"
  | "held"
  | "bondSent"
  | "awaiting"
  | "bonded"
  | "finalized"
  | "trigger"
  | "collecting";
export type WChip = "Stuck" | "Trigger ready" | "Held" | "Collecting" | "Finalized";
export type WState = {
  key: WKey;
  label: string;
  tone: "plain" | "leaf" | "mint" | "warn" | "danger";
  chip: WChip | null;
  next: string;
  stuckStep: string | null;
};
export type WItem = { row: WRow; state: WState };

export const CHIPS: WChip[] = ["Stuck", "Trigger ready", "Held", "Collecting", "Finalized"];

// The engine's job label names the step (fee-stuck.ts stepOf): the tag word and the timeline's retry button.
const STEP: Record<string, { name: string; retry: string }> = {
  finalize: { name: "Finalize", retry: "Retry finalize split" },
  "forced bond": { name: "Forced bond", retry: "Retry forced bond" },
  forcedBond: { name: "Forced bond", retry: "Retry forced bond" },
  sweep: { name: "Sweep", retry: "Retry sweep" },
  distribute: { name: "Distribute", retry: "Distribute now" },
};
const stepCopy = (step: string) =>
  STEP[step] ?? { name: step.charAt(0).toUpperCase() + step.slice(1), retry: `Retry ${step}` };

type NextArgs = { step?: string | null; reason?: string | null; left?: string | null };

/** D-31 next expected step, also the timeline's "Next" line. */
export function nextStepCopy(key: WKey, a: NextArgs = {}): string {
  switch (key) {
    case "stuck":
      return stepCopy(a.step ?? "job").retry;
    case "unconfirmed":
      return "Re-check launch";
    case "held":
      return `Held: ${a.reason ?? "review"}`;
    case "bondSent":
      return "Bond sent, confirming";
    case "awaiting":
      return "Awaiting migration";
    case "bonded":
      return "Finalize next";
    case "finalized":
      return a.left ? `Distribute in ${a.left}` : "Distribute after finalize";
    case "trigger":
      return "Forced bond, sending";
    case "collecting":
      return a.left ? `Collect in ${a.left}` : "Collecting";
  }
}

/** Milliseconds to the end of the current fee window. */
export function windowMsLeft(row: WRow, now: number, windowMs: number): number {
  const at = Date.parse(row.launchedAt);
  return windowEnd(at, windowOf(at, now, windowMs), windowMs) - now;
}

/** Budget over cost passes the forced bond's 105% (PROJECT.md default 2). A cost of 0 or unknown never does. */
export function triggerReady(row: WRow): boolean {
  if (row.venue !== "curve" || row.cost === null || BigInt(row.cost) <= 0n) return false;
  return trigger105(budgetOf(BigInt(row.feeBudget), BigInt(row.feesUnclaimed)), BigInt(row.cost));
}

/** The burn budget in lamports at the stored BONDR price; null when there is a budget but no price yet. */
export function budgetSol(row: WRow): bigint | null {
  const b = budgetOf(BigInt(row.feeBudget), BigInt(row.feesUnclaimed));
  if (b === 0n) return 0n;
  return row.bondrSol === null ? null : toSol(b, row.bondrSol);
}

type Base = Omit<WState, "next" | "stuckStep">;
const BASE: Record<WKey, Base> = {
  stuck: { key: "stuck", label: "", tone: "danger", chip: "Stuck" },
  unconfirmed: { key: "unconfirmed", label: "Launch unconfirmed", tone: "danger", chip: "Stuck" },
  held: { key: "held", label: "Held", tone: "warn", chip: "Held" },
  bondSent: { key: "bondSent", label: "Bond sent", tone: "mint", chip: null },
  awaiting: { key: "awaiting", label: "Awaiting migration", tone: "mint", chip: null },
  bonded: { key: "bonded", label: "Bonded", tone: "mint", chip: null },
  finalized: { key: "finalized", label: "Finalized", tone: "leaf", chip: "Finalized" },
  trigger: { key: "trigger", label: "Trigger ready", tone: "leaf", chip: "Trigger ready" },
  collecting: { key: "collecting", label: "Collecting", tone: "plain", chip: "Collecting" },
};

// Pattern 6 order: the first rule that matches wins.
function keyOf(row: WRow, mem: AdminCoinMemory | undefined): WKey {
  if (mem?.stuck) return "stuck";
  if (row.launch === "unconfirmed") return "unconfirmed";
  if (row.heldAt || row.finalize === "held" || mem?.hold) return "held";
  if (row.bondSent) return "bondSent";
  if (row.venue === "complete") return "awaiting";
  if (row.venue === "pool") return row.finalize === "done" ? "finalized" : "bonded";
  return triggerReady(row) ? "trigger" : "collecting";
}

export function wState(row: WRow, mem: AdminCoinMemory | undefined, now: number, windowMs: number): WState {
  const key = keyOf(row, mem);
  const step = key === "stuck" ? (mem?.stuck?.step ?? "job") : null;
  const reason = row.heldReason ?? mem?.hold ?? (row.finalize === "held" ? "finalize deployer check" : null);
  const left = windowLeft(windowMsLeft(row, now, windowMs));
  const base = BASE[key];
  const label = step ? `${stepCopy(step).name} stuck` : base.label;
  return { ...base, label, next: nextStepCopy(key, { step, reason, left }), stuckStep: step };
}

const RANK: Record<WKey, number> = {
  ...{ stuck: 0, unconfirmed: 0, trigger: 1, held: 2, bondSent: 3, awaiting: 4, bonded: 5 },
  ...{ collecting: 6, finalized: 7 },
};
const ratioOf = (r: WRow) =>
  ratio1000(budgetOf(BigInt(r.feeBudget), BigInt(r.feesUnclaimed)).toString(), r.cost);

// Within a group: Collecting by vs cost (highest first, unknown last), Finalized by newest bond, else as given.
function within(a: WItem, b: WItem): number {
  if (a.state.key === "collecting") return (ratioOf(b.row) ?? -1) - (ratioOf(a.row) ?? -1);
  if (a.state.key === "finalized") return (b.row.bondedAt ?? "").localeCompare(a.row.bondedAt ?? "");
  return 0;
}

/** UI-SPEC sort: stuck, Trigger ready, Held, Bond sent, Awaiting migration, Bonded, Collecting, Finalized. */
export const sortRows = (list: WItem[]): WItem[] =>
  [...list].sort((a, b) => RANK[a.state.key] - RANK[b.state.key] || within(a, b));

export function chipCounts(list: WItem[]): Record<"All" | WChip, number> {
  const out = { All: list.length, ...Object.fromEntries(CHIPS.map((c) => [c, 0])) } as Record<
    "All" | WChip,
    number
  >;
  for (const { state } of list) if (state.chip) out[state.chip] += 1;
  return out;
}

/** The default selection on open: the first stuck coin in table order, else none. */
export const firstStuck = (list: WItem[]): string | null =>
  list.find((i) => i.state.chip === "Stuck")?.row.mint ?? null;

/** Every coin of one overview load, joined to its engine memory and sorted for the table. */
export function wItems(rows: WRow[], coins: AdminCoinMemory[], now: number, windowMs: number): WItem[] {
  const mem = new Map(coins.map((c) => [c.mint, c]));
  return sortRows(rows.map((row) => ({ row, state: wState(row, mem.get(row.mint), now, windowMs) })));
}
