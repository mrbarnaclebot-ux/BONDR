// Records the live pump config and flags drift from the PROJECT.md fee assumptions. Drift is evidence,
// never a failure: devnet differs by design (Pitfall 7), and the fork row decides what we build on.
import { readLiveConfig } from "@bondr/core/config";
import type { Row, Stage } from "../results.ts";

type Facts = NonNullable<Row["facts"]>;

// PROJECT.md "Fee Mechanic" item 3, plus the depth-1 pump coin quote from item 1.
const ASSUMED = { curveProtocol: 95, curveCreator: 150, ammLp: 20, ammProtocol: 5, minCurveDepth: 1 };

const FACT_KEYS = [
  "creatorFeeConfigurable",
  "maxConfigurableCreatorFeeBps",
  "maxCurveDepth",
  "initialVirtualSolReserves",
  "initialVirtualTokenReserves",
  "initialRealTokenReserves",
  "tokenTotalSupply",
  "withdrawAuthority",
  "buybackFeeRecipient0",
  "createV2Enabled",
  "globalBytes",
  "curveFlat.protocol",
  "curveFlat.creator",
  "curveExotic.protocol",
  "curveExotic.creator",
  "ammFlat.lp",
  "ammFlat.protocol",
  "ammFlat.creator",
  "ammExotic.lp",
  "ammExotic.protocol",
  "ammExotic.creator",
  "ammTier0.lp",
  "ammTier0.protocol",
  "ammTier0.creator",
  "drift",
];

// BONDR-quoted coins are pump coin quotes, so the exotic schedule applies; the program treats an
// all-zero exotic schedule as unset and charges the flat one instead.
function effective(f: Facts, exotic: string, flat: string, field: string): number {
  const unset = ["lp", "protocol", "creator"].every((k) => !Number(f[`${exotic}.${k}`] ?? 0));
  return Number(f[`${unset ? flat : exotic}.${field}`]);
}

function drift(f: Facts): string[] {
  const out: string[] = [];
  const curveProtocol = effective(f, "curveExotic", "curveFlat", "protocol");
  if (curveProtocol !== ASSUMED.curveProtocol) out.push(`curve protocol ${curveProtocol} bps, assumed 95`);
  const max = Number(f.maxConfigurableCreatorFeeBps);
  if (!f.creatorFeeConfigurable) out.push("creator fee not configurable, assumed 150 bps per coin");
  else if (max < ASSUMED.curveCreator) out.push(`max creator fee ${max} bps, below assumed 150`);
  const ammLp = effective(f, "ammExotic", "ammFlat", "lp");
  if (ammLp !== ASSUMED.ammLp) out.push(`AMM LP ${ammLp} bps, assumed 20`);
  const ammProtocol = effective(f, "ammExotic", "ammFlat", "protocol");
  if (ammProtocol !== ASSUMED.ammProtocol) out.push(`AMM protocol ${ammProtocol} bps, assumed 5`);
  if (Number(f.maxCurveDepth) < ASSUMED.minCurveDepth) out.push(`maxCurveDepth ${f.maxCurveDepth}, need 1`);
  return out;
}

export const configStage: Stage = {
  name: "config",
  rules: () => ({
    config: (row) => {
      const missing = FACT_KEYS.filter((k) => row.facts?.[k] === undefined);
      return missing.length ? `missing facts: ${missing.join(", ")}` : null;
    },
  }),
  async run(ctx) {
    const facts = await readLiveConfig(ctx.conn);
    const found = drift(facts);
    ctx.record({
      id: "config",
      step: "Live pump config",
      ok: true,
      facts: { ...facts, drift: found.join("; ") },
    });
  },
};
