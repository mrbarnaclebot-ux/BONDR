// Devnet stages in run order. Each later plan appends one stage here.
import type { Stage } from "../results.ts";
import { configStage } from "../stages/config.ts";
import { createStage } from "../stages/create.ts";

const stages: Stage[] = [configStage, createStage];
export default stages;
