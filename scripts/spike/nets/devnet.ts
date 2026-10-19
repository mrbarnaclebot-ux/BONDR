// Devnet stages in run order. Each later plan appends one stage here.
import type { Stage } from "../results.ts";
import { configStage } from "../stages/config.ts";
import { createStage } from "../stages/create.ts";
import { launchStage } from "../stages/launch.ts";
import { multihopStage } from "../stages/multihop.ts";
import { sharingStage } from "../stages/sharing.ts";

const stages: Stage[] = [configStage, createStage, launchStage, multihopStage, sharingStage];
export default stages;
