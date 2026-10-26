// The pump contract check in the worker (OPS-02, D-18..D-22): at boot, on its own Monday timer (so it also runs in
// genesis mode and with FEE_ENGINE off, Pitfall 8) and on demand (POST /admin/contract-check). A mismatch turns
// every switch off; only the owner turns them back on (D-20). RPC only: the one database write is the pause.
// ponytail: the result is memory-only and per process, fine for one replica; a restart reruns the check at boot.
import type { AdminContract } from "@bondr/core/api-admin";
import { type CheckResult, checkContract, type ProgramName } from "@bondr/core/contract";
import type { Net } from "@bondr/core/keys";
import { redact } from "@bondr/core/net";
import type { Connection, PublicKey } from "@solana/web3.js";
import { type AuditStore, audited, pgAudit } from "./admin-audit.ts";
import { nextBatchAt } from "./fee-batch.ts";
import { switchesOff } from "./switches.ts";

const DAY_MS = 86_400_000;
const MONDAY = 1;

export type CheckDeps = {
  check: () => Promise<CheckResult>;
  off: () => Promise<void>;
  audit: () => AuditStore;
  now: () => number;
};

const NOT_RUN: AdminContract = { kind: "not_run", at: null, facts: [], programs: [], lastPass: null };
let state: AdminContract = NOT_RUN;
// True while the latest completed run is a mismatch: launches stay paused until a run passes, even if the owner
// turns the switches back on before re-running the check (D-20).
let failed = false;
let baseline: Record<ProgramName, string> | null = null; // deploy slots seen by the first run since boot
let running: Promise<AdminContract> | null = null;
let wired: CheckDeps | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;

export const contractState = (): AdminContract => ({ ...state });
export const contractFailed = (): boolean => failed;

export const contractDeps = (conn: Connection, net: Net, bondr?: PublicKey): CheckDeps => ({
  check: () => checkContract(conn, net, bondr),
  off: switchesOff,
  audit: () => pgAudit(),
  now: Date.now,
});

// Tests only: module memory back to a fresh boot.
export function resetCheck(): void {
  [state, failed, baseline, running, wired] = [NOT_RUN, false, null, null, null];
  clearTimeout(timer);
}

const iso = (ms: number) => new Date(ms).toISOString();
const message = (e: unknown) => redact(e instanceof Error ? e.message : String(e));

// The error log names the facts before the write, so Sentry hears it even when the database is down.
async function pause(d: CheckDeps, facts: string[]): Promise<void> {
  console.error(`contract check mismatch, pausing every switch: ${facts.join("; ")}`);
  const params = { job: "all", enabled: false, facts };
  await audited(d.audit(), { actor: "contract_check", action: "switch", mint: null, params }, d.off).catch(
    (e: unknown) => console.error(`contract check pause write failed: ${message(e)}`),
  );
}

async function run(d: CheckDeps): Promise<AdminContract> {
  const prior = state;
  state = { ...prior, kind: "running" };
  let r: CheckResult;
  try {
    r = await d.check();
  } catch (e) {
    // An RPC failure is "could not run": it pauses nothing and keeps the last pass (T-07-10-06).
    console.error(`contract check could not run: ${message(e)}`);
    state = { ...prior, kind: "failed", at: iso(d.now()), facts: [], programs: [] };
    return contractState();
  }
  const at = iso(d.now());
  baseline ??= r.slots;
  const base = baseline;
  const programs = (Object.keys(r.slots) as ProgramName[]).filter((n) => r.slots[n] !== base[n]);
  if (r.facts.length) {
    failed = true;
    state = { kind: "mismatch", at, facts: r.facts, programs, lastPass: prior.lastPass };
    await pause(d, r.facts);
    return contractState();
  }
  failed = false;
  const s = r.slots;
  console.log(`contract check passed: pump=${s.pump} pump AMM=${s["pump AMM"]} pump fees=${s["pump fees"]}`);
  // Pump deploys often without breaking BONDR: a changed slot with every fact passing is amber, not a pause.
  if (programs.length)
    console.warn(`contract check: ${programs.join(", ")} redeployed since boot, facts pass`);
  state = { kind: programs.length ? "redeployed" : "passed", at, facts: [], programs, lastPass: at };
  return contractState();
}

// One run at a time: a call during a run gets that run. Before boot wires the deps it answers the state as is.
export function runCheck(d: CheckDeps | null = wired): Promise<AdminContract> {
  if (!d) return Promise.resolve(contractState());
  running ??= run(d).finally(() => {
    running = null;
  });
  return running;
}

// The next Monday at the batch hour (UTC); restart-safe, unlike "every 7th day since boot".
export function nextCheckAt(now: number, hour: number): number {
  let at = nextBatchAt(now, hour);
  while (new Date(at).getUTCDay() !== MONDAY) at += DAY_MS;
  return at;
}

// One in-memory timer that re-arms after each run, whatever the outcome; it reads nothing itself.
export function scheduleCheck(hour: number, d: CheckDeps): void {
  wired = d;
  clearTimeout(timer);
  const fire = () => void runCheck(d).finally(() => scheduleCheck(hour, d));
  timer = setTimeout(fire, nextCheckAt(d.now(), hour) - d.now());
  timer.unref();
}
