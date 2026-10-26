// The worker side of the contract check (OPS-02, D-20, D-21): a forced mismatch turns every switch off with one
// audit row, a redeploy only warns, an RPC failure pauses nothing. The check, the switch write and the audit
// store are injected, so no RPC and no database.
import { type CheckInput, type CheckResult, judge, PROFILES } from "@bondr/core/contract";
import { PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from "@bondr/core/pump";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { memoryAudit } from "./admin-audit.ts";

const { contractFailed, contractState, nextCheckAt, resetCheck, runCheck } = await import(
  "./contract-check.ts"
);

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const [PUMP, AMM, FEES] = [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID].map(String);
// Live devnet facts (2026-10-26, RESEARCH Pattern 5) with Global grown by 8 bytes: judged against the mainnet
// profile, that is a wrong value (the creator fee) and a wrong account size.
const DEVNET: CheckInput = {
  programs: (["pump", "pump AMM", "pump fees"] as const).map((name) => ({
    name,
    executable: true,
    owner: LOADER,
  })),
  accounts: [
    { name: "Global", size: 1096, owner: PUMP, disc: "a7e8e8b1c86c727f", decodes: true },
    { name: "FeeConfig", size: 4097, owner: FEES, disc: "8f3492bbdb7b4c9b", decodes: true },
    { name: "AMM GlobalConfig", size: 949, owner: AMM, disc: "95089ccaa0fcb0d9", decodes: true },
    { name: "AMM FeeConfig", size: 4097, owner: FEES, disc: "8f3492bbdb7b4c9b", decodes: true },
  ],
  config: {
    ...{
      createV2Enabled: true,
      creatorFeeConfigurable: false,
      maxConfigurableCreatorFeeBps: "0",
      maxCurveDepth: 2,
    },
    ...{ "curveFlat.protocol": "95", "curveFlat.creator": "30", "curveExotic.protocol": "0" },
    ...{ "curveExotic.creator": "0", "ammFlat.lp": "25", "ammFlat.protocol": "5", "ammFlat.creator": "0" },
    ...{ "ammExotic.lp": "0", "ammExotic.protocol": "0", "ammExotic.creator": "0" },
  },
};
const SLOTS = { pump: "510657843", "pump AMM": "508659436", "pump fees": "508659783" };
const NOW = Date.parse("2026-10-26T04:00:00Z");

function deps(check: () => Promise<CheckResult>) {
  const audit = memoryAudit();
  return { audit, off: vi.fn(async () => undefined), d: { check, audit: () => audit, now: () => NOW } };
}
const ok =
  (slots = SLOTS) =>
  async (): Promise<CheckResult> => ({ facts: [], slots });

beforeEach(() => resetCheck());
afterEach(() => vi.restoreAllMocks());

test("a forced mismatch turns every switch off once, with one contract_check audit row (D-21)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const facts = judge(DEVNET, PROFILES.mainnet);
  expect(facts).toContain("Global account is 1096 bytes, expected 1088");
  expect(facts).toContain("creator fee not configurable, assumed 150 bps per coin");
  const t = deps(async () => ({ facts, slots: SLOTS }));
  const s = await runCheck({ ...t.d, off: t.off });
  expect(t.off).toHaveBeenCalledTimes(1);
  expect(t.audit.rows).toHaveLength(1);
  expect(t.audit.rows[0]).toMatchObject({
    ...{ actor: "contract_check", action: "switch", mint: null, result: "landed" },
    params: { job: "all", enabled: false, facts },
  });
  expect(s).toMatchObject({ kind: "mismatch", facts });
  expect(contractState().kind).toBe("mismatch");
  expect(contractFailed()).toBe(true);
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining(facts[0] as string));
});

test("a pass logs the slots in the grep-able line and keeps everything on", async () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const t = deps(ok());
  expect(await runCheck({ ...t.d, off: t.off })).toMatchObject({
    kind: "passed",
    facts: [],
    lastPass: expect.any(String),
  });
  expect(log).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    "contract check passed: pump=510657843 pump AMM=508659436 pump fees=508659783",
  );
  expect(t.off).not.toHaveBeenCalled();
  expect(contractFailed()).toBe(false);
});

test("passing facts with a changed deploy slot is redeployed: a warning, not a pause", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const t = deps(ok());
  await runCheck({ ...t.d, off: t.off }); // the boot baseline
  const s = await runCheck({ ...t.d, off: t.off, check: ok({ ...SLOTS, "pump AMM": "520000000" }) });
  expect(s).toMatchObject({ kind: "redeployed", programs: ["pump AMM"] });
  expect(warn).toHaveBeenCalledTimes(1);
  expect(t.off).not.toHaveBeenCalled();
  expect(contractFailed()).toBe(false);
});

test("after a mismatch, contractFailed stays true until a later run passes (D-20)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const t = deps(async () => ({ facts: ["Global discriminator changed"], slots: SLOTS }));
  await runCheck({ ...t.d, off: t.off });
  expect(contractFailed()).toBe(true);
  expect(contractFailed()).toBe(true); // the owner turning switches back on does not clear it
  await runCheck({ ...t.d, off: t.off, check: ok() });
  expect(contractFailed()).toBe(false);
});

test("a check that throws is 'could not run': nothing paused, the last pass kept", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const t = deps(ok());
  const passed = await runCheck({ ...t.d, off: t.off });
  const s = await runCheck({
    ...t.d,
    off: t.off,
    check: async () => {
      throw new Error("429 Too Many Requests");
    },
  });
  expect(s).toMatchObject({ kind: "failed", lastPass: passed.lastPass });
  expect(t.off).not.toHaveBeenCalled();
  expect(contractFailed()).toBe(false);
});

test("two concurrent runs share one check", async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  const check = vi.fn(ok());
  const t = deps(check);
  const [a, b] = await Promise.all([runCheck({ ...t.d, off: t.off }), runCheck({ ...t.d, off: t.off })]);
  expect(check).toHaveBeenCalledTimes(1);
  expect(a).toEqual(b);
});

test("nextCheckAt is the next Monday at the hour, the same Monday when the hour is still ahead", () => {
  const at = (iso: string) => new Date(nextCheckAt(Date.parse(iso), 4)).toISOString();
  expect(at("2026-10-26T03:59:00Z")).toBe("2026-10-26T04:00:00.000Z"); // Monday before the hour
  expect(at("2026-10-26T04:00:00Z")).toBe("2026-11-02T04:00:00.000Z"); // Monday at the hour
  expect(at("2026-10-28T12:00:00Z")).toBe("2026-11-02T04:00:00.000Z"); // Wednesday
  expect(at("2026-11-01T23:00:00Z")).toBe("2026-11-02T04:00:00.000Z"); // Sunday
});
