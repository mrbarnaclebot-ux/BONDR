// Records the live pump config and flags drift from the PROJECT.md fee assumptions. Drift is evidence,
// never a failure: devnet differs by design (Pitfall 7), and the fork row decides what we build on.
import { readLiveConfig } from "@bondr/core/config";
import { drift, PROFILES } from "@bondr/core/contract";
import type { Stage } from "../results.ts";

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
    const found = drift(facts, PROFILES.mainnet); // the PROJECT.md assumptions on every net, as before
    ctx.record({
      id: "config",
      step: "Live pump config",
      ok: true,
      facts: { ...facts, drift: found.join("; ") },
    });
  },
};
