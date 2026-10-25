// Worker entry: config, one RPC connection, the private HTTP API. One process, no standing polling loop
// (Pitfall 6: Neon must be able to scale to zero between requests); settle polls only while a launch is in
// flight, and the vanity refill runs only on boot and on demand.
// First (a side-effect import, so import sorting keeps it first): Sentry is up before other modules log.
import "./sentry.ts";
import { close, db } from "@bondr/core/db";
import { connect, redact } from "@bondr/core/net";
import { OnlinePumpSdk } from "@bondr/core/pump";
import { seedBondrPrice } from "./bondr-price.ts";
import { loadEnv, type WorkerEnv } from "./env.ts";
import { endStreams, eventsHandler } from "./events-route.ts";
import { feeEngine, startEngine } from "./fee-boot.ts";
import { feeRoutes } from "./fee-routes.ts";
import { startRefill } from "./grind.ts";
import { start } from "./http.ts";
import { backfillLaunches, loadCoins } from "./ingest.ts";
import { type PrepareCtx, prepare } from "./prepare.ts";
import { flush } from "./sentry.ts";
import { resumeLaunches } from "./settle.ts";
import { type Ctx, liveStatus, quote, setSwitch } from "./status.ts";
import { backoff, startStream } from "./stream.ts";
import { submit } from "./submit.ts";
import { loadSwitches } from "./switches.ts";
import { prepareTrade } from "./trade-prepare.ts";
import { quoteTrade, tradeBalance } from "./trade-quote.ts";
import { submitTrade, viewTrade } from "./trade-submit.ts";

const failed = (what: string) => (e: unknown) =>
  console.error(`${what} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

// The coin registry, BONDR's price and the owner's switches in memory, the fee engine (boot recovery before any job), a one-time
// pass over launches not indexed yet, then the live stream (which gap fills every coin on open). A failure retries with the stream's capped backoff: every
// step is idempotent, and exiting instead would also stop launches once Railway's restart retries run out.
async function bootIndex(ctx: Ctx, env: WorkerEnv, attempt = 0): Promise<void> {
  try {
    await seedBondrPrice(ctx);
    await loadCoins(db());
    const s = await loadSwitches();
    const [l, f, w, z, b] = [s.launches, s.forcedBond, s.sweeps, s.finalize, s.buybackBurn].map((v) =>
      v ? "on" : "off",
    );
    console.log(`switches: launches=${l} forcedBond=${f} sweeps=${w} finalize=${z} buybackBurn=${b}`);
    await startEngine(ctx, env);
    console.log(`backfilled ${await backfillLaunches(ctx.conn)} launches`);
  } catch (e) {
    failed("index boot")(e);
    setTimeout(() => void bootIndex(ctx, env, attempt + 1), backoff(attempt));
    return;
  }
  startStream(ctx, env.net);
}

const SAMPLE_ADDR = "9wRtPq3yq1ZJ8yQd2ynVfUKAnx3bK2SMQkkjD8Kq4e3F";

async function main() {
  const env = loadEnv();
  const conn = await connect(env.net);
  const ctx: Ctx = { conn, online: new OnlinePumpSdk(conn), Q: env.quoteMint, priorityFee: env.priorityFee };
  const pctx: PrepareCtx = { ...ctx, env };
  const tctx = { ...ctx, net: env.net };
  const server = start(
    {
      "GET /status": () => liveStatus(ctx),
      "POST /quote": (body) => quote(ctx, body),
      "POST /prepare": (body) => prepare(pctx, body),
      "POST /submit": (body) => submit(pctx, body),
      "POST /kill-switch": (body) => setSwitch(body),
      "POST /trade/quote": (body) => quoteTrade(tctx, body),
      "POST /trade/balance": (body) => tradeBalance(ctx, body),
      "POST /trade/prepare": (body) => prepareTrade(tctx, body),
      "POST /trade/submit": (body) => submitTrade(tctx, body),
      "POST /trade/view": async (body) => viewTrade(body),
      ...feeRoutes(feeEngine),
      // OPS-01 check: the 500 path logs this through redact and Sentry must show [addr], not the address.
      "POST /sentry-test": async () => {
        throw new Error(`sentry test from worker: wallet ${SAMPLE_ADDR}`);
      },
    },
    env.token,
    undefined,
    { "GET /events": eventsHandler },
  );
  server.on("listening", () => {
    console.log(`worker listening on ${env.net}`);
    void startRefill(env);
    void bootIndex(ctx, env);
    resumeLaunches(conn).catch(failed("resume"));
  });
  process.once("SIGTERM", () => {
    server.close(() => void close().finally(() => process.exit(0)));
    endStreams();
  });
}

main().catch((e: unknown) => {
  console.error(`worker failed to start: ${redact(e instanceof Error ? e.message : String(e))}`);
  void flush().finally(() => process.exit(1));
});
