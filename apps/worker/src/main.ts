// Worker entry: config, one RPC connection, the private HTTP API. One process, no polling loop (Pitfall 6:
// Neon must be able to scale to zero between requests); the vanity refill runs only on boot and on demand.
import { close } from "@bondr/core/db";
import { connect, redact } from "@bondr/core/net";
import { OnlinePumpSdk } from "@bondr/core/pump";
import { loadEnv } from "./env.ts";
import { startRefill } from "./grind.ts";
import { start } from "./http.ts";
import { type PrepareCtx, prepare } from "./prepare.ts";
import { type Ctx, liveStatus, quote } from "./status.ts";

async function main() {
  const env = loadEnv();
  const conn = await connect(env.net);
  const ctx: Ctx = { conn, online: new OnlinePumpSdk(conn), Q: env.quoteMint, priorityFee: env.priorityFee };
  const pctx: PrepareCtx = { ...ctx, env };
  const server = start(
    {
      "GET /status": () => liveStatus(ctx),
      "POST /quote": (body) => quote(ctx, body),
      "POST /prepare": (body) => prepare(pctx, body),
    },
    env.token,
  );
  server.on("listening", () => {
    console.log(`worker listening on ${env.net}`);
    void startRefill(env);
  });
  process.once("SIGTERM", () => {
    server.close(() => void close().finally(() => process.exit(0)));
  });
}

main().catch((e: unknown) => {
  console.error(`worker failed to start: ${redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});
