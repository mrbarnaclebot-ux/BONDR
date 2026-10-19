// Fork stages in run order: the Surfpool mainnet fork covers what devnet cannot (D-01), like 150 bps.
import type { Stage } from "../results.ts";
import { bondStage } from "../stages/bond.ts";
import { configStage } from "../stages/config.ts";
import { createStage } from "../stages/create.ts";
import { launchStage } from "../stages/launch.ts";
import { prebondStage } from "../stages/prebond.ts";

const stages: Stage[] = [configStage, createStage, launchStage, prebondStage, bondStage];
export default stages;
