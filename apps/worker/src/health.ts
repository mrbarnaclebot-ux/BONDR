// What the health panel reads from worker memory (D-22, D-26): when this process booted, which replica it is,
// and when each job last ran. Never touches Postgres, so an open admin tab cannot keep Neon awake (D-02).
// ponytail: per-process memory, so it resets on restart and the panel shows "since boot"; persist the marks only
// if the owner needs history across deploys.
import { randomBytes } from "node:crypto";

export const bootAt = Date.now();
// A11: Railway names each replica; locally a random id tells two processes apart.
export const instance = process.env.RAILWAY_REPLICA_ID || randomBytes(4).toString("hex");

export type Mark = "stream" | "engine" | "split" | "bondCheck" | "sweep" | "distribute" | "buyback";

const at: Record<Mark, number | null> = {
  ...{ stream: null, engine: null, split: null, bondCheck: null },
  ...{ sweep: null, distribute: null, buyback: null },
};

export function mark(name: Mark, now = Date.now()): void {
  at[name] = now;
}

export const marks = (): Record<Mark, number | null> => ({ ...at });
