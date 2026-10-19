// Devnet stages in run order. Each later plan appends one stage here.
import type { Stage } from "../results.ts";
import { configStage } from "../stages/config.ts";

const stages: Stage[] = [configStage];
export default stages;
