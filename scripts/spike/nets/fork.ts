// Fork stages in run order: the Surfpool mainnet fork covers what devnet cannot (D-01), like 150 bps.
import type { Stage } from "../results.ts";
import { bondStage } from "../stages/bond.ts";
import { completeStage } from "../stages/complete.ts";
import { configStage } from "../stages/config.ts";
import { createStage } from "../stages/create.ts";
import { engineBondStage } from "../stages/engine-bond.ts";
import { finalizeStage } from "../stages/finalize.ts";
import { launchStage } from "../stages/launch.ts";
import { migratedStage } from "../stages/migrated.ts";
import { multihopStage } from "../stages/multihop.ts";
import { poolStage } from "../stages/pool.ts";
import { awaitingStage, poolLaunchStage } from "../stages/pool-launch.ts";
import { prebondStage } from "../stages/prebond.ts";

const stages: Stage[] = [
  configStage,
  createStage,
  launchStage,
  prebondStage,
  bondStage,
  poolStage,
  finalizeStage,
  // Q still on its curve: E1 force-bonds and E2 bonds by trades, both through the engine's fee-burns.ts.
  engineBondStage,
  // Q still on its curve, C2 on its PumpSwap pool: SOL -> Q curve -> C2 pool.
  multihopStage("C2", "bonded."),
  completeStage,
  // Q is complete and unmigrated only between these two stages; the pool launches need it migrated.
  awaitingStage,
  migratedStage,
  poolLaunchStage,
  multihopStage("C3", "migrated."),
  // Q migrated: SOL -> Q pool -> C2 pool, both hops on PumpSwap.
  multihopStage("C2", "pooled."),
];
export default stages;
