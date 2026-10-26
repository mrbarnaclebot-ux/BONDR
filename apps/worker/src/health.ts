// What the health panel reads from worker memory (D-22, D-26): when this process booted, which replica it is,
// and when each job last ran. Never touches Postgres, so an open admin tab cannot keep Neon awake (D-02).
// ponytail: per-process memory, so it resets on restart and the panel shows "since boot"; persist the marks only
// if the owner needs history across deploys.
import { randomBytes } from "node:crypto";
import type { AdminHealth } from "@bondr/core/api-admin";
import { contractState } from "./contract-check.ts";
import type { WorkerEnv } from "./env.ts";
import type { Engine } from "./fee-engine.ts";
import { opsLow } from "./fee-send.ts";
import { rpcStats } from "./rpc-stats.ts";
import { sentryCount } from "./sentry-count.ts";
import { switchState } from "./switches.ts";

export const bootAt = Date.now();
// A11: Railway names each replica; locally a random id tells two processes apart.
export const instance = process.env.RAILWAY_REPLICA_ID || randomBytes(4).toString("hex");

export type Mark = "stream" | "split" | "bondCheck" | "sweep" | "distribute" | "buyback";

const at: Record<Mark, number | null> = {
  ...{ stream: null, split: null, bondCheck: null },
  ...{ sweep: null, distribute: null, buyback: null },
};

export function mark(name: Mark, now = Date.now()): void {
  at[name] = now;
}

export const marks = (): Record<Mark, number | null> => ({ ...at });

type HealthOpts = {
  env: Pick<WorkerEnv, "feeEngine" | "adminEvacuate" | "sentryReadToken" | "quoteMint">;
  engine: () => Pick<Engine, "stuckCount"> | null;
};

// D-25: one replica and no lock, so the "leader lock" row is this instance and its boot time. The only await is
// the Sentry count, cached 60 s and never a database read.
export async function healthSnapshot(o: HealthOpts): Promise<AdminHealth> {
  const { stream, ...lastRuns } = marks();
  const { evacuatedAt, ...switches } = switchState();
  const ran = Object.values(lastRuns).filter((t): t is number => t !== null);
  return {
    bootAt,
    instance,
    lastStream: stream,
    lastEngine: ran.length ? Math.max(...ran) : null, // the newest job run
    lastRuns,
    rpc: rpcStats(),
    stuck: o.engine()?.stuckCount() ?? { count: 0, first: null },
    switches,
    evacuatedAt,
    feeEngine: o.env.feeEngine,
    opsLow: opsLow(),
    evacuate: o.env.adminEvacuate,
    contract: contractState(),
    genesis: o.env.quoteMint === null,
    sentry: await sentryCount(o.env.sentryReadToken),
  };
}
