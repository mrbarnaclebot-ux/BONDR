// Worker entry: config, one RPC connection, the private HTTP API. One process, no standing polling loop
// (Pitfall 6: Neon must be able to scale to zero between requests); settle polls only while a launch is in
// flight, and the vanity refill runs only on boot and on demand.
// First (a side-effect import, so import sorting keeps it first): Sentry is up before other modules log.
import "./sentry.ts";
import { close, db } from "@bondr/core/db";
import { connect, redact } from "@bondr/core/net";
import { OnlinePumpSdk } from "@bondr/core/pump";
import { pgAudit, settleStale } from "./admin-audit.ts";
import { adminRoutes } from "./admin-routes.ts";
import { seedBondrPrice } from "./bondr-price.ts";
import { contractDeps, runCheck, scheduleCheck } from "./contract-check.ts";
import { buyback, loadEnv, ops, type WorkerEnv } from "./env.ts";
import { endStreams, eventsHandler } from "./events-route.ts";
import { feeEngine, startEngine } from "./fee-boot.ts";
import { feeRoutes } from "./fee-routes.ts";
import { enterGenesis, genesisRoutes, verifyQuoteMint } from "./genesis-boot.ts";
import { startRefill } from "./grind.ts";
import { bootAt } from "./health.ts";
import { type Routes, start } from "./http.ts";
import { backfillLaunches, loadCoins } from "./ingest.ts";
import { type PrepareCtx, prepare } from "./prepare.ts";
import { timedFetch } from "./rpc-stats.ts";
import { flush } from "./sentry.ts";
import { resumeLaunches } from "./settle.ts";
import { type Ctx, liveStatus, quote, setSwitch } from "./status.ts";
import { backoff, startStream } from "./stream.ts";
import { submit } from "./submit.ts";
import { loadSwitches, switchesLine } from "./switches.ts";
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
    console.log(switchesLine(await loadSwitches()));
    await startEngine(ctx, env);
    console.log(`backfilled ${await backfillLaunches(ctx.conn, ctx.Q)} launches`);
  } catch (e) {
    failed("index boot")(e);
    setTimeout(() => void bootIndex(ctx, env, attempt + 1), backoff(attempt));
    return;
  }
  startStream(ctx, env.net);
}

const SAMPLE_ADDR = "9wRtPq3yq1ZJ8yQd2ynVfUKAnx3bK2SMQkkjD8Kq4e3F";

function childRoutes(ctx: Ctx, env: WorkerEnv): Routes {
  const pctx: PrepareCtx = { ...ctx, env };
  return {
    "GET /status": () => liveStatus(ctx),
    "POST /quote": (body) => quote(ctx, body),
    "POST /prepare": (body) => prepare(pctx, body),
    "POST /submit": (body) => submit(pctx, body),
    "POST /kill-switch": (body) => setSwitch(body, pgAudit()),
    "POST /trade/quote": (body) => quoteTrade(ctx, body),
    "POST /trade/balance": (body) => tradeBalance(ctx, body),
    "POST /trade/prepare": (body) => prepareTrade(ctx, body),
    "POST /trade/submit": (body) => submitTrade(ctx, body),
    "POST /trade/view": async (body) => viewTrade(body),
    ...feeRoutes(feeEngine),
  };
}

async function main() {
  const env = loadEnv();
  const conn = await connect(env.net, { fetch: timedFetch });
  const base = { conn, online: new OnlinePumpSdk(conn), priorityFee: env.priorityFee, net: env.net };
  const ctx: Ctx | null = env.quoteMint && { ...base, Q: env.quoteMint };
  // D-29, D-31: one branch at boot. Genesis writes every switch off before any route answers; after genesis a
  // wrong BONDR mint refuses to start (devnet skips the check: its BONDR is a test mint).
  if (!ctx) await enterGenesis();
  else if (env.net === "mainnet") await verifyQuoteMint(base.online, ctx.Q, env.treasury);
  const shared: Routes = {
    ...adminRoutes({ env, engine: feeEngine, conn }),
    // OPS-01 check: the 500 path logs this through redact and Sentry must show [addr], not the address.
    "POST /sentry-test": async () => {
      throw new Error(`sentry test from worker: wallet ${SAMPLE_ADDR}`);
    },
  };
  const gctx = { ...base, Q: null, treasury: env.treasury, env };
  const routes = ctx ? { ...childRoutes(ctx, env), ...shared } : genesisRoutes(gctx, shared);
  const server = start(routes, env.token, undefined, { "GET /events": eventsHandler });
  server.on("listening", () => {
    console.log(`worker listening on ${env.net}${ctx ? "" : " (genesis)"}`);
    // Public keys only, so the G-3 and G-4 steps read the ops address from the logs without touching the seed.
    const [o, b] = [ops(env.seed, env.net).publicKey, buyback(env.seed, env.net, env.lane).publicKey];
    console.log(`wallets: ops=${o.toBase58()} buyback=${b.toBase58()} treasury=${env.treasury.toBase58()}`);
    void startRefill(env);
    // Its own timer, apart from bootIndex and the fee batch, so it runs in every mode (Pitfall 8).
    scheduleCheck(env.feeBatchHourUtc, contractDeps(conn, env.net, ctx?.Q));
    runCheck().catch(failed("contract check"));
    if (ctx) void bootIndex(ctx, env); // genesis has no coins to index and no engine (D-29)
    resumeLaunches(conn).catch(failed("resume"));
    settleStale(new Date(bootAt))
      .then((n) => n && console.log(`settled ${n} admin audit rows left pending by an earlier process`))
      .catch(failed("admin audit boot settle"));
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
