// UI-SPEC Wallets and Health cell copy (D-22, D-25 to D-28). Pure, so the unit test pins every line.
import type { AdminBalances, AdminHealth } from "@bondr/core/api-admin";
import { age, feeSol, relTime, thousands, whole, windowLeft } from "./format";

export type Tone = "plain" | "ok" | "warn" | "danger" | "muted";
export type Cell = { value: string; sub: string; tone: Tone };

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (ms: number) => new Date(ms).toISOString();

/** Local "14:02:11", or "14:02" without seconds. */
export function clock(ms: number, seconds = true): string {
  const d = new Date(ms);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${hm}:${pad(d.getSeconds())}` : hm;
}

/** "12s ago" under a minute, then "4m ago", "3h ago", "2d ago". */
export function since(t: number, now: number): string {
  const s = Math.max(0, Math.floor((now - t) / 1000));
  return s < 60 ? `${s}s ago` : `${relTime(iso(t), now)} ago`;
}

const plural = (n: number, one: string, many: string) => `${thousands(n)} ${n === 1 ? one : many}`;

type Poll = { health: AdminHealth | null; failedAt: number | null; lastOk: number | null };

export function heartbeatCopy({ health, failedAt, lastOk }: Poll, now: number): Cell {
  if (failedAt !== null) {
    const sub = lastOk === null ? "No answer since the page opened" : `Last answer ${clock(lastOk)}`;
    return { value: "Not answering", sub, tone: "danger" };
  }
  if (!health) return { value: "Checking…", sub: "", tone: "muted" };
  const seen = [health.lastStream, health.lastEngine].filter((t): t is number => t !== null);
  return {
    value: seen.length ? since(Math.max(...seen), now) : "No activity since boot",
    sub: `Up ${age(iso(health.bootAt), now)}, booted ${clock(health.bootAt, false)}`,
    tone: "ok",
  };
}

// Owner-delegated threshold: 2% of RPC calls failing is worth a look.
export function rpcCopy(rpc: AdminHealth["rpc"]): Cell {
  const value =
    rpc.p50 === null || rpc.p95 === null
      ? "No calls in 1h"
      : `p50 ${Math.round(rpc.p50)}ms, p95 ${Math.round(rpc.p95)}ms`;
  const sub = `${(rpc.errorRate * 100).toFixed(1)}% errors, ${rpc.rateLimited} rate-limited (429) in 1h`;
  return { value, sub, tone: rpc.errorRate >= 0.02 ? "warn" : "plain" };
}

export function lastRunsCopy(runs: AdminHealth["lastRuns"], now: number): Cell {
  const r = (t: number | null) => (t === null ? "not since boot" : since(t, now));
  return {
    value: `split ${r(runs.split)}, bond check ${r(runs.bondCheck)}`,
    sub: `sweep ${r(runs.sweep)}, distribute ${r(runs.distribute)}, buyback ${r(runs.buyback)}`,
    tone: "plain",
  };
}

export function stuckCopy(stuck: AdminHealth["stuck"], symbolOf: (mint: string) => string | null): Cell {
  if (stuck.count === 0) return { value: "None", sub: "", tone: "muted" };
  const f = stuck.first;
  const sub = f ? `${symbolOf(f.mint) ?? f.mint.slice(0, 4)}: ${f.step}, ${f.attempts} attempts` : "";
  return { value: `${plural(stuck.count, "coin", "coins")} stuck`, sub, tone: "danger" };
}

export function sentryCopy(s: AdminHealth["sentry"]): Cell {
  if (!s.configured)
    return { value: "Not configured", sub: "Set a read-only Sentry token to count issues", tone: "muted" };
  if ("failed" in s) return { value: "Could not read", sub: "Sentry did not answer", tone: "warn" };
  const n = s.web + s.worker;
  return {
    value: s.capped ? "100+ open issues" : `${plural(n, "open issue", "open issues")}`,
    sub: `web ${s.web}, worker ${s.worker}`,
    tone: n > 0 ? "warn" : "plain",
  };
}

// ponytail: one worker tx is about the 0.001 SOL Sender tip plus base and priority fees; devnet pays no tip,
// so the estimate reads low there. Read the real per-tx spend from the ledger if the estimate misleads.
const TX_LAMPORTS = 1_010_000n;

export function opsCopy(b: AdminBalances): Cell {
  const floor = feeSol(b.opsFloor);
  const value = `${feeSol(b.opsSol)} SOL`;
  if (BigInt(b.opsSol) >= BigInt(b.opsFloor))
    return { value, sub: `Pays every worker fee. Alert below ${floor} SOL.`, tone: "plain" };
  const left = thousands(BigInt(b.opsSol) / TX_LAMPORTS);
  const sub = `Below the ${floor} SOL alert. About ${left} worker transactions left. Top up from the treasury.`;
  return { value, sub, tone: "warn" };
}

// BONDR base units at the worker's price (lamports per base unit); null before the boot seed.
const bondrValue = (base: string, price: number | null): string | null =>
  price === null ? null : feeSol(String(BigInt(Math.round(Number(base) * price))));

export function treasuryCopy(b: AdminBalances): Cell {
  const v = bondrValue(b.treasuryBondr, b.bondrSol) ?? "–";
  return {
    value: `${feeSol(b.treasurySol)} SOL`,
    sub: `plus ${whole(b.treasuryBondr)} BONDR (${v} SOL). EVACUATE destination.`,
    tone: "plain",
  };
}

// D-07: the BONDR held, valued in SOL, leads; the BONDR amount moves to the sub-line.
export function buybackCopy(b: AdminBalances, now: number): Cell {
  const v = bondrValue(b.buybackBondr, b.bondrSol);
  return {
    value: v === null ? "–" : `${v} SOL`,
    sub: `${whole(b.buybackBondr)} BONDR. Next scheduled burn in ${windowLeft(b.nextBurnAt - now)}.`,
    tone: "plain",
  };
}

export type Totals = { coins: number; bonded: number; volume30d: string; treasury30d: string };

export const totalsCopy = (t: Totals): string[] => [
  plural(t.coins, "coin", "coins"),
  `${thousands(t.bonded)} bonded`,
  `${feeSol(t.volume30d)} SOL volume, 30d`,
  `${feeSol(t.treasury30d)} SOL to treasury, 30d`,
];

const PAGE_LOAD = "As of page load.";

export const vanityCopy = (free: number): Cell => ({
  value: `${thousands(free)} bndr mints`,
  sub: `Alert below 100. ${PAGE_LOAD}`,
  tone: free < 100 ? "warn" : "plain",
});

export type Reconcile = { count: number; first: { symbol: string; bondr: string } | null };

export function reconcileCopy(r: Reconcile): Cell {
  if (r.count === 0 || !r.first) return { value: "Clean", sub: PAGE_LOAD, tone: "plain" };
  const off = whole(r.first.bondr.replace(/^-/, ""));
  return {
    value: plural(r.count, "discrepancy", "discrepancies"),
    sub: `${r.first.symbol} W off by ${off} BONDR. ${PAGE_LOAD}`,
    tone: "warn",
  };
}
