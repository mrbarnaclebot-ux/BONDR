// UI-SPEC Timeline (ADMIN-08, D-31): one coin's history from its launch row, its fee_ledger rows (held and
// reconcile_diff included) and the engine's memory, ending in one stuck, held or next step. Pure, so the client
// builds it with its own clock; the one DB read is coinTimeline in admin-timeline-data.ts (server-only).
import type { Exit, LedgerKind, LedgerState } from "@bondr/core/api";
import type { AdminCoinLive, AdminCoinMemory } from "@bondr/core/api-admin";
import type { WRow } from "./admin-data";
import { wState } from "./admin-state";
import { age, compact, sol, whole } from "./format";

export type Step = {
  key: string;
  title: string;
  state: "done" | "stuck" | "held" | "next";
  at: string | null;
  detail: string | null; // the full sub-line, age included
  sig: string | null;
};
export type TimelineLaunch = {
  state: string;
  exit: Exit;
  solIn: string;
  signature: string | null;
  wallet: string; // the launch signer: finalize's recorded deployer (D-15)
  tokens: string | null;
  landedAt: string | null;
  createdAt: string;
};
export type TimelineRow = {
  kind: LedgerKind;
  state: LedgerState | null;
  amount: string | null;
  burned: string | null;
  sol: string | null;
  signature: string | null;
  windowIndex: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
  landedAt: string | null;
};
export type CoinTimeline = { launch: TimelineLaunch | null; rows: TimelineRow[] };

type Done = { key: string; title: string; at: string; detail: string | null; sig: string | null };

const BONDR = (base: string | null) => `${whole(base ?? "0")} BONDR`;
const sum = (rows: TimelineRow[]) => rows.reduce((n, r) => n + BigInt(r.amount ?? "0"), 0n).toString();
const timeOf = (r: TimelineRow) => r.landedAt ?? r.createdAt;

// Many rows of one kind read as one step: the newest time and signature, the total moved.
function folded(key: string, title: string, rows: TimelineRow[]): Done[] {
  const last = rows.at(-1);
  return last ? [{ key, title, at: timeOf(last), detail: BONDR(sum(rows)), sig: last.signature }] : [];
}

type Line = { title: string; detail: string | null };
const burned = (r: TimelineRow, symbol: string) => `${compact(r.burned ?? "0")} ${symbol} burned`;

// One step per row for these kinds; finalize_config adds "Pending fees swept" first when it swept any.
const LINE: Partial<Record<LedgerKind, (r: TimelineRow, symbol: string) => Line>> = {
  forced_bond: (r, s) => ({ title: "Forced-bond buy and burn", detail: burned(r, s) }),
  pool_burn: (r, s) => ({ title: "Fallback buy and burn", detail: burned(r, s) }),
  finalize_config: () => ({ title: "create_fee_sharing_config", detail: null }),
  finalize_update: (r) => ({
    title: "update_fee_shares_v2",
    detail: `${r.detail?.dBps ?? "–"} / ${r.detail?.tBps ?? "–"} bps`,
  }),
  sweep_buyback: (r) => ({
    title: `Swept to buyback, window ${(r.windowIndex ?? 0) + 1}`,
    detail: BONDR(r.amount),
  }),
  leftover_burn: (r, s) => ({ title: "Leftovers swept, accounts closed", detail: burned(r, s) }),
  evacuate: (r) => ({
    title: "Evacuated to treasury",
    detail: r.amount === null ? `${sol(r.sol ?? "0")} SOL` : BONDR(r.amount),
  }),
  reconcile_diff: (r) => ({
    title: `Reconcile mismatch, ${whole(String(r.detail?.diff ?? "0"))} BONDR`,
    detail: null,
  }),
};

function one(r: TimelineRow, symbol: string): Done[] {
  const line = LINE[r.kind];
  if (!line) return [];
  const base = { key: `${r.kind}-${r.createdAt}`, at: timeOf(r), sig: r.signature };
  const swept =
    r.kind === "finalize_config" && r.amount !== null && r.amount !== "0"
      ? [{ ...base, key: `${base.key}-swept`, title: "Pending fees swept", detail: BONDR(r.amount) }]
      : [];
  return [...swept, { ...base, ...line(r, symbol) }];
}

// Landed tx rows, plus reconcile diffs (no tx). Collects fold into one step (each split is its collect's 10%) and
// distributes into another; a window's treasury half rides with its buyback half; held rows feed the held step.
function ledgerSteps(rows: TimelineRow[], symbol: string): Done[] {
  const shown = rows.filter((r) => r.state === "landed" || r.kind === "reconcile_diff");
  const collects = shown.filter((r) => r.kind === "collect");
  return [
    ...folded("collect", `Collect and split, ${collects.length} runs`, collects),
    ...folded(
      "distribute",
      "Distributed post-bond fees",
      shown.filter((r) => r.kind === "distribute"),
    ),
    ...shown.flatMap((r) => one(r, symbol)),
  ];
}

function launchStep(l: TimelineLaunch, symbol: string): Done {
  const title = l.exit === "sell" ? "Launched, insta sell" : "Launched, insta burn";
  const detail =
    l.exit === "burn" && l.tokens ? `${compact(l.tokens)} ${symbol} burned` : `${sol(l.solIn)} SOL dev buy`;
  return { key: "launch", title, at: l.landedAt ?? l.createdAt, detail, sig: l.signature };
}

// The engine's job label names the stuck step (fee-stuck.ts stepOf).
function stuckTitle(step: string, rows: TimelineRow[]): string {
  if (step === "finalize")
    return rows.some((r) => r.kind === "finalize_config" && r.state === "landed")
      ? "update_fee_shares_v2"
      : "create_fee_sharing_config";
  const named: Record<string, string> = {
    "forced bond": "Forced-bond buy and burn",
    forcedBond: "Forced-bond buy and burn",
    sweep: "Window sweep",
    distribute: "Distribute post-bond fees",
  };
  return named[step] ?? `${step.charAt(0).toUpperCase()}${step.slice(1)}`;
}

function heldAt(row: WRow, rows: TimelineRow[]): string | null {
  return row.heldAt ?? rows.findLast((r) => r.kind === "held")?.createdAt ?? null;
}

function lastStep(
  t: CoinTimeline,
  row: WRow,
  mem: AdminCoinMemory | undefined,
  now: number,
  windowMs: number,
): Step {
  const s = wState(row, mem, now, windowMs);
  if (s.key === "stuck" && mem?.stuck) {
    const at = new Date(mem.stuck.at).toISOString();
    const detail = `Stuck, ${mem.stuck.attempts} attempts`;
    return { key: "stuck", title: stuckTitle(mem.stuck.step, t.rows), state: "stuck", at, detail, sig: null };
  }
  if (s.key === "held") {
    const at = heldAt(row, t.rows);
    const title = row.finalize === "held" ? "Finalize held" : "Held for review";
    return {
      key: "held",
      title,
      state: "held",
      at,
      detail: at ? `Held ${age(at, now)} ago` : "Held",
      sig: null,
    };
  }
  return { key: "next", title: "Up next", state: "next", at: null, detail: s.next, sig: null };
}

const done = (d: Done, now: number): Step => ({
  ...d,
  state: "done",
  detail: d.detail ? `${age(d.at, now)} ago, ${d.detail}` : `${age(d.at, now)} ago`,
});

/** The Timeline steps: launch first, then ledger and migration steps by time, then one stuck, held or next. */
export function timelineSteps(
  t: CoinTimeline,
  row: WRow,
  mem: AdminCoinMemory | undefined,
  live: AdminCoinLive | null,
  now: number,
  windowMs: number,
): Step[] {
  const memory = live?.memory ?? mem; // the live read is fresher than the overview's memory
  if (row.launch === "unconfirmed") {
    const l = t.launch ? launchStep(t.launch, row.symbol) : { key: "launch", title: "Launch", sig: null };
    return [
      { key: "launch", title: l.title, state: "next", at: null, detail: "Re-check launch", sig: l.sig },
    ];
  }
  const migrated: Done[] =
    row.venue === "pool" && row.bondedAt
      ? [{ key: "migrated", title: "Migrated to PumpSwap", at: row.bondedAt, detail: null, sig: null }]
      : [];
  const middle = [...ledgerSteps(t.rows, row.symbol), ...migrated].sort((a, b) => a.at.localeCompare(b.at));
  const head = t.launch ? [launchStep(t.launch, row.symbol)] : [];
  return [...[...head, ...middle].map((d) => done(d, now)), lastStep(t, row, memory, now, windowMs)];
}
