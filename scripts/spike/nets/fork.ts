// Fork stages in run order: the Surfpool mainnet fork covers what devnet cannot (D-01), like 150 bps.
import type { Stage } from "../results.ts";
import { bondStage } from "../stages/bond.ts";
import { completeStage } from "../stages/complete.ts";
import { configStage } from "../stages/config.ts";
import { createStage } from "../stages/create.ts";
import { finalizeStage } from "../stages/finalize.ts";
import { launchStage } from "../stages/launch.ts";
import { migratedStage } from "../stages/migrated.ts";
import { poolStage } from "../stages/pool.ts";
import { prebondStage } from "../stages/prebond.ts";

const stages: Stage[] = [
  configStage,
  createStage,
  launchStage,
  prebondStage,
  bondStage,
  poolStage,
  finalizeStage,
  completeStage,
  migratedStage,
];
export default stages;
