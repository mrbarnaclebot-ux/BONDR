// The health snapshot (D-22, D-26): every field from worker memory. The database module keeps its table objects
// (other admin routes build queries from them at import) but db() throws, so any query fails the test; the
// console polls this every 10 s and must never wake Neon.
import { Keypair } from "@solana/web3.js";
import { expect, test, vi } from "vitest";

vi.mock("@bondr/core/db", async (actual) => ({
  ...(await actual<typeof import("@bondr/core/db")>()),
  db: () => {
    throw new Error("health touched the database");
  },
}));

const { adminRoutes } = await import("./admin-routes.ts");
const { bootAt, healthSnapshot, instance, mark } = await import("./health.ts");
const { note } = await import("./rpc-stats.ts");

import type { WorkerEnv } from "./env.ts";
import type { Engine } from "./fee-engine.ts";

const ADMIN = Keypair.generate().publicKey.toBase58();
const env = {
  adminWallet: ADMIN,
  feeEngine: "dry",
  adminEvacuate: "on",
  sentryReadToken: null,
} as unknown as WorkerEnv;
const first = { mint: "M1", step: "finalize", attempts: 3 };
const engine = { stuckCount: () => ({ count: 2, first }) } as unknown as Engine;

test("every field comes from memory, with no database", async () => {
  mark("stream", 500);
  mark("split", 100);
  mark("distribute", 300);
  note(200, 12);
  const h = await healthSnapshot({ env, engine: () => engine });
  expect(h).toEqual({
    bootAt,
    instance,
    lastStream: 500,
    lastEngine: 300,
    lastRuns: { split: 100, bondCheck: null, sweep: null, distribute: 300, buyback: null },
    rpc: { p50: 12, p95: 12, errorRate: 0, rateLimited: 0, count: 1 },
    stuck: { count: 2, first },
    switches: { launches: false, forcedBond: false, sweeps: false, finalize: false, buybackBurn: false },
    evacuatedAt: null,
    feeEngine: "dry",
    opsLow: false,
    evacuate: "on",
    sentry: { configured: false },
  });
});

test("no engine reports nothing stuck", async () => {
  const h = await healthSnapshot({ env, engine: () => null });
  expect(h.stuck).toEqual({ count: 0, first: null });
});

test("POST /admin/health answers the admin actor and refuses another", async () => {
  const health = adminRoutes({ env, engine: () => null, conn: {} as never })["POST /admin/health"];
  expect(await health({ actor: ADMIN })).toMatchObject({ bootAt, instance, feeEngine: "dry" });
  const other = Keypair.generate().publicKey.toBase58();
  await expect(health({ actor: other })).rejects.toMatchObject({ status: 403 });
});
