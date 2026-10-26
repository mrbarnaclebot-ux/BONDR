import type { AdminBalances, AdminHealth } from "@bondr/core/api-admin";
import { expect, test } from "vitest";
import { auditTime } from "./admin-copy-audit";
import {
  buybackCopy,
  clock,
  contractCopy,
  heartbeatCopy,
  lastRunsCopy,
  opsCopy,
  reconcileCopy,
  rpcCopy,
  sentryCopy,
  stuckCopy,
  totalsCopy,
  treasuryCopy,
  vanityCopy,
} from "./admin-copy-health";

const NOW = new Date(2026, 9, 25, 14, 2, 11).getTime();

const health = (over: Partial<AdminHealth> = {}): AdminHealth => ({
  bootAt: NOW - 3 * 3_600_000,
  instance: "a1b2c3d4",
  lastStream: NOW - 12_000,
  lastEngine: NOW - 40_000,
  lastRuns: { split: NOW - 240_000, bondCheck: null, sweep: null, distribute: null, buyback: null },
  rpc: { p50: 41.6, p95: 210, errorRate: 0, rateLimited: 0, count: 120 },
  stuck: { count: 0, first: null },
  switches: { launches: true, forcedBond: true, sweeps: true, finalize: true, buybackBurn: true },
  evacuatedAt: null,
  feeEngine: "on",
  opsLow: false,
  evacuate: "simulate",
  contract: { kind: "not_run", at: null, facts: [], programs: [], lastPass: null },
  genesis: false,
  sentry: { configured: false },
  ...over,
});

const balances = (over: Partial<AdminBalances> = {}): AdminBalances => ({
  treasurySol: "2500000000",
  treasuryBondr: "12000000000",
  buybackSol: "10000000",
  buybackBondr: "3000000000",
  opsSol: "400000000",
  opsFloor: "50000000",
  bondrSol: 0.5,
  nextBurnAt: NOW + 2 * 3_600_000 + 5 * 60_000,
  ...over,
});

test("heartbeat counts from the newer of the stream and the engine, and fails loud", () => {
  const ok = heartbeatCopy({ health: health(), failedAt: null, lastOk: NOW }, NOW);
  expect(ok.value).toBe("12s ago");
  expect(ok.sub).toBe(`Up 3h 0m, booted ${clock(NOW - 3 * 3_600_000, false)}`);
  expect(ok.tone).toBe("ok");
  const down = heartbeatCopy({ health: health(), failedAt: NOW, lastOk: NOW - 20_000 }, NOW);
  expect(down).toEqual({ value: "Not answering", sub: "Last answer 14:01:51", tone: "danger" });
});

test("rpc warns at a 2% error rate", () => {
  expect(rpcCopy(health().rpc)).toEqual({
    value: "p50 42ms, p95 210ms",
    sub: "0.0% errors, 0 rate-limited (429) in 1h",
    tone: "plain",
  });
  expect(rpcCopy({ ...health().rpc, errorRate: 0.019 }).tone).toBe("plain");
  const bad = rpcCopy({ ...health().rpc, errorRate: 0.02, rateLimited: 3 });
  expect(bad.tone).toBe("warn");
  expect(bad.sub).toBe("2.0% errors, 3 rate-limited (429) in 1h");
});

test("last runs say not since boot for a job that has not run", () => {
  const c = lastRunsCopy(health().lastRuns, NOW);
  expect(c.value).toBe("split 4m ago, bond check not since boot");
  expect(c.sub).toBe("sweep not since boot, distribute not since boot, buyback not since boot");
});

test("stuck names the first coin by symbol", () => {
  expect(stuckCopy(health().stuck, () => "X").value).toBe("None");
  const s = stuckCopy({ count: 2, first: { mint: "M1", step: "finalize", attempts: 3 } }, (m) =>
    m === "M1" ? "GRUB" : null,
  );
  expect(s).toEqual({ value: "2 coins stuck", sub: "GRUB: finalize, 3 attempts", tone: "danger" });
});

test("sentry covers not configured, failed and capped", () => {
  expect(sentryCopy({ configured: false })).toEqual({
    value: "Not configured",
    sub: "Set a read-only Sentry token to count issues",
    tone: "muted",
  });
  expect(sentryCopy({ configured: true, failed: true }).value).toBe("Could not read");
  expect(sentryCopy({ configured: true, web: 0, worker: 0, capped: false }).tone).toBe("plain");
  const capped = sentryCopy({ configured: true, web: 70, worker: 30, capped: true });
  expect(capped).toEqual({ value: "100+ open issues", sub: "web 70, worker 30", tone: "warn" });
});

test("ops below the floor warns with the transactions left", () => {
  expect(opsCopy(balances())).toEqual({
    value: "0.4 SOL",
    sub: "Pays every worker fee. Alert below 0.05 SOL.",
    tone: "plain",
  });
  const low = opsCopy(balances({ opsSol: "30300000" }));
  expect(low.tone).toBe("warn");
  expect(low.sub).toBe(
    "Below the 0.05 SOL alert. About 30 worker transactions left. Top up from the treasury.",
  );
});

test("treasury and buyback lead with SOL", () => {
  expect(treasuryCopy(balances())).toEqual({
    value: "2.5 SOL",
    sub: "plus 12,000 BONDR (6 SOL). EVACUATE destination.",
    tone: "plain",
  });
  expect(buybackCopy(balances(), NOW)).toEqual({
    value: "1.5 SOL",
    sub: "3,000 BONDR. Next scheduled burn in 2h 5m.",
    tone: "plain",
  });
  expect(buybackCopy(balances({ bondrSol: null }), NOW).value).toBe("–");
});

test("vanity warns below 100 and reconcile names the first diff", () => {
  expect(vanityCopy(100).tone).toBe("plain");
  expect(vanityCopy(99)).toEqual({
    value: "99 bndr mints",
    sub: "Alert below 100. As of page load.",
    tone: "warn",
  });
  expect(reconcileCopy({ count: 0, first: null })).toEqual({
    value: "Clean",
    sub: "As of page load.",
    tone: "plain",
  });
  expect(reconcileCopy({ count: 2, first: { symbol: "GRUB", bondr: "-5000000" } })).toEqual({
    value: "2 discrepancies",
    sub: "GRUB W off by 5 BONDR. As of page load.",
    tone: "warn",
  });
});

test("totals read counts and 30-day SOL", () => {
  expect(totalsCopy({ coins: 1204, bonded: 9, volume30d: "140700000000", treasury30d: "420000000" })).toEqual(
    ["1,204 coins", "9 bonded", "140.7 SOL volume, 30d", "0.42 SOL to treasury, 30d"],
  );
});

const STATIC = "Program IDs, IDL layouts, Global flags. Runs at boot and weekly.";
const AT = new Date(NOW - 60_000).toISOString();
const PASS = new Date(NOW - 7 * 86_400_000).toISOString();
const contract = (over: Partial<AdminHealth["contract"]>): AdminHealth["contract"] => ({
  ...{ kind: "passed", at: AT, facts: [], programs: [], lastPass: AT },
  ...over,
});

test("contract: not run, checking and passed read the static sub-line", () => {
  expect(contractCopy(contract({ kind: "not_run", at: null, lastPass: null }), NOW)).toEqual({
    ...{ value: "Not run since boot", sub: STATIC, tone: "muted" },
  });
  expect(contractCopy(contract({ kind: "running" }), NOW)).toEqual({
    ...{ value: "Checking…", sub: STATIC, tone: "muted" },
  });
  expect(contractCopy(contract({}), NOW)).toEqual({
    ...{ value: `Passed ${auditTime(AT, NOW)}`, sub: STATIC, tone: "ok" },
  });
});

test("contract: a redeploy is amber and names the programs", () => {
  const two = contractCopy(contract({ kind: "redeployed", programs: ["pump", "pump AMM"] }), NOW);
  expect(two.value).toBe("Passed, pump redeployed");
  expect(two.tone).toBe("warn");
  expect(two.sub).toBe(
    `pump and pump AMM redeployed since the last check. Every fact still passes; nothing was paused. Checked ${auditTime(AT, NOW)}.`,
  );
  const one = contractCopy(contract({ kind: "redeployed", programs: ["pump fees"] }), NOW);
  expect(one.sub.startsWith("pump fees redeployed since the last check.")).toBe(true);
  const all = contractCopy(
    contract({ kind: "redeployed", programs: ["pump", "pump AMM", "pump fees"] }),
    NOW,
  );
  expect(all.sub.startsWith("pump, pump AMM and pump fees redeployed")).toBe(true);
});

test("contract: a mismatch is danger with the dot and every fact", () => {
  const facts = [
    "creator fee not configurable, assumed 150 bps per coin",
    "Global account is 1096 bytes, expected 1088",
  ];
  expect(contractCopy(contract({ kind: "mismatch", facts }), NOW)).toEqual({
    value: "Mismatch, jobs paused",
    sub: `${facts[0]}; ${facts[1]}. Checked ${auditTime(AT, NOW)}. Every job was paused. Turn them back on one at a time after review. Launches stay paused until Run check now passes.`,
    tone: "danger",
    dot: true,
  });
});

test("contract: could not run names the last pass when there is one", () => {
  expect(contractCopy(contract({ kind: "failed", lastPass: PASS }), NOW)).toEqual({
    ...{
      value: "Could not run",
      sub: `The RPC did not answer. Last pass ${auditTime(PASS, NOW)}.`,
      tone: "warn",
    },
  });
  expect(contractCopy(contract({ kind: "failed", lastPass: null }), NOW).sub).toBe("The RPC did not answer.");
});
