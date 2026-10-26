// The pure judge against the facts measured on live devnet and mainnet on 2026-10-26 (RESEARCH Pattern 5).
// No network: the gatherer is a separate function (Pitfall 6).
import { expect, test } from "vitest";
import { type CheckInput, judge, PROFILES } from "./contract.ts";
import { PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_PROGRAM_ID } from "./pump.ts";

const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
const [PUMP, AMM, FEES] = [PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID].map((k) =>
  k.toBase58(),
);

const MAINNET_CONFIG = {
  ...{
    createV2Enabled: true,
    creatorFeeConfigurable: true,
    maxConfigurableCreatorFeeBps: "300",
    maxCurveDepth: 2,
  },
  ...{ "curveFlat.protocol": "95", "curveFlat.creator": "30", "curveExotic.protocol": "95" },
  ...{ "curveExotic.creator": "30", "ammFlat.lp": "25", "ammFlat.protocol": "5", "ammFlat.creator": "0" },
  ...{ "ammExotic.lp": "20", "ammExotic.protocol": "5", "ammExotic.creator": "5" },
};
const DEVNET_CONFIG = {
  ...MAINNET_CONFIG,
  ...{ creatorFeeConfigurable: false, maxConfigurableCreatorFeeBps: "0" },
  ...{ "curveExotic.protocol": "0", "curveExotic.creator": "0" },
  ...{ "ammExotic.lp": "0", "ammExotic.protocol": "0", "ammExotic.creator": "0" },
};

function measured(config: CheckInput["config"]): CheckInput {
  return {
    programs: [
      { name: "pump", executable: true, owner: LOADER },
      { name: "pump AMM", executable: true, owner: LOADER },
      { name: "pump fees", executable: true, owner: LOADER },
    ],
    accounts: [
      { name: "Global", size: 1088, owner: PUMP, disc: "a7e8e8b1c86c727f", decodes: true },
      { name: "FeeConfig", size: 4097, owner: FEES, disc: "8f3492bbdb7b4c9b", decodes: true },
      { name: "AMM GlobalConfig", size: 949, owner: AMM, disc: "95089ccaa0fcb0d9", decodes: true },
      { name: "AMM FeeConfig", size: 4097, owner: FEES, disc: "8f3492bbdb7b4c9b", decodes: true },
      { name: "BONDR bonding curve", size: 166, owner: PUMP, disc: "17b7f83760d8ac60", decodes: true },
    ],
    config: { ...config },
  };
}
const withAccount = (i: CheckInput, name: string, over: Partial<CheckInput["accounts"][number]>) => ({
  ...i,
  accounts: i.accounts.map((a) => (a.name === name ? { ...a, ...over } : a)),
});

test("each measured network passes its own profile", () => {
  expect(judge(measured(MAINNET_CONFIG), PROFILES.mainnet)).toEqual([]);
  expect(judge(measured(DEVNET_CONFIG), PROFILES.devnet)).toEqual([]);
});

test("devnet facts against the mainnet profile give the spike strings plus the max fact", () => {
  expect(judge(measured(DEVNET_CONFIG), PROFILES.mainnet).sort()).toEqual(
    [
      "creator fee not configurable, assumed 150 bps per coin",
      "max creator fee 0 bps, below assumed 150",
      "AMM LP 25 bps, assumed 20",
    ].sort(),
  );
});

test("account size, discriminator and decode each give their fact", () => {
  const m = measured(MAINNET_CONFIG);
  expect(judge(withAccount(m, "Global", { size: 1100 }), PROFILES.mainnet)).toEqual([
    "Global account is 1100 bytes, expected 1088",
  ]);
  expect(judge(withAccount(m, "Global", { disc: "0000000000000000" }), PROFILES.mainnet)).toEqual([
    "Global discriminator changed",
  ]);
  expect(judge(withAccount(m, "Global", { decodes: false }), PROFILES.mainnet)).toEqual([
    "Global no longer decodes with the pinned SDK",
  ]);
});

test("a program that is not executable or not loader-owned gives its fact", () => {
  const m = measured(MAINNET_CONFIG);
  const programs = (name: string, over: object) => ({
    ...m,
    programs: m.programs.map((p) => (p.name === name ? { ...p, ...over } : p)),
  });
  expect(judge(programs("pump", { executable: false }), PROFILES.mainnet)).toEqual([
    "pump program missing or not executable",
  ]);
  expect(judge(programs("pump AMM", { owner: PUMP }), PROFILES.mainnet)).toEqual([
    "pump AMM program not owned by the upgradeable loader",
  ]);
});

test("Global flags: create_v2 off and depth 0", () => {
  const m = measured(MAINNET_CONFIG);
  expect(judge({ ...m, config: { ...m.config, createV2Enabled: false } }, PROFILES.mainnet)).toEqual([
    "create_v2 disabled",
  ]);
  expect(judge({ ...m, config: { ...m.config, maxCurveDepth: 0 } }, PROFILES.mainnet)).toEqual([
    "maxCurveDepth 0, need 1",
  ]);
});

test("the fork profile is the mainnet profile", () => {
  expect(PROFILES.fork).toEqual(PROFILES.mainnet);
});
