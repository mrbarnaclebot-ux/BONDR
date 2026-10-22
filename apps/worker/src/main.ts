// Worker entry: config, one RPC connection, the private HTTP API. One process, no standing polling loop
// (Pitfall 6: Neon must be able to scale to zero between requests); settle polls only while a launch is in
// flight, and the vanity refill runs only on boot and on demand.
// First (a side-effect import, so import sorting keeps it first): Sentry is up before other modules log.
import "./sentry.ts";
import { close } from "@bondr/core/db";
import { connect, redact } from "@bondr/core/net";
import { OnlinePumpSdk } from "@bondr/core/pump";
import { loadEnv } from "./env.ts";
import { startRefill } from "./grind.ts";
import { start } from "./http.ts";
import { type PrepareCtx, prepare } from "./prepare.ts";
import { flush } from "./sentry.ts";
import { resumeLaunches } from "./settle.ts";
import { type Ctx, liveStatus, quote, setSwitch } from "./status.ts";
import { submit } from "./submit.ts";

const SAMPLE_ADDR = "9wRtPq3yq1ZJ8yQd2ynVfUKAnx3bK2SMQkkjD8Kq4e3F";

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
      "POST /submit": (body) => submit(pctx, body),
      "POST /kill-switch": (body) => setSwitch(body),
      // OPS-01 check: the 500 path logs this through redact and Sentry must show [addr], not the address.
      "POST /sentry-test": async () => {
        throw new Error(`sentry test from worker: wallet ${SAMPLE_ADDR}`);
      },
    },
    env.token,
  );
  server.on("listening", () => {
    console.log(`worker listening on ${env.net}`);
    void startRefill(env);
    resumeLaunches(conn).catch((e: unknown) =>
      console.error(`resume failed: ${redact(e instanceof Error ? e.message : String(e))}`),
    );
  });
  process.once("SIGTERM", () => {
    server.close(() => void close().finally(() => process.exit(0)));
  });
}

main().catch((e: unknown) => {
  console.error(`worker failed to start: ${redact(e instanceof Error ? e.message : String(e))}`);
  void flush().finally(() => process.exit(1));
});
