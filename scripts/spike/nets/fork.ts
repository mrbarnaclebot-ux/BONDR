// Fork stages in run order: the Surfpool mainnet fork covers what devnet cannot (D-01), like 150 bps.
import type { Stage } from "../results.ts";
import { configStage } from "../stages/config.ts";

const stages: Stage[] = [configStage];
export default stages;
