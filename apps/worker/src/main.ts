// Worker entry: config, one RPC connection, the private HTTP API. One process, no background loop
// (Pitfall 6: Neon must be able to scale to zero between requests).
import { close } from "@bondr/core/db";
import { connect, redact } from "@bondr/core/net";
import { OnlinePumpSdk } from "@bondr/core/pump";
import { loadEnv } from "./env.ts";
import { start } from "./http.ts";
import { type Ctx, liveStatus, quote } from "./status.ts";

async function main() {
  const env = loadEnv();
  const conn = await connect(env.net);
  const ctx: Ctx = { conn, online: new OnlinePumpSdk(conn), Q: env.quoteMint, priorityFee: env.priorityFee };
  const server = start(
    {
      "GET /status": () => liveStatus(ctx),
      "POST /quote": (body) => quote(ctx, body),
    },
    env.token,
  );
  server.on("listening", () => console.log(`worker listening on ${env.net}`));
  process.once("SIGTERM", () => {
    server.close(() => void close().finally(() => process.exit(0)));
  });
}

main().catch((e: unknown) => {
  console.error(`worker failed to start: ${redact(e instanceof Error ? e.message : String(e))}`);
  process.exit(1);
});
