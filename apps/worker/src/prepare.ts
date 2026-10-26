// POST /prepare (LAUNCH-03, FEE-10): the unsigned launch tx, built only where the seed lives. Every cheap
// guard runs before ops spends table rent (Pitfall 5); the exact message bytes are stored for the byte
// compare at submit (Pattern 3, sign order A).
import type { Exit, PrepareResult } from "@bondr/core/api";
import { db } from "@bondr/core/db";
import { derive } from "@bondr/core/keys";
import type { LaunchOpts } from "@bondr/core/launch";
import { redact } from "@bondr/core/net";
import { BN } from "@bondr/core/pump";
import { checkSymbol, reservedTicker } from "@bondr/core/rules";
import { type AddressLookupTableAccount, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { blocked } from "./admin-moderate.ts";
import {
  type Builds,
  buildMessage,
  compileLaunch,
  ensureTable,
  previewCosts,
  simulateLaunch,
  tipped,
  unionTableKeys,
} from "./build.ts";
import { ops, type WorkerEnv } from "./env.ts";
import { feeConfig, launchTip } from "./fee-config.ts";
import { tipIxs } from "./fee-send.ts";
import { startRefill } from "./grind.ts";
import { Fail, fail } from "./http.ts";
import {
  consented,
  insertFailed,
  insertPrepared,
  type NewLaunch,
  newId,
  newTablesLastHour,
  newTablesToday,
  tableFor,
} from "./launches.ts";
import { parseRequest, prepareGuard, type Req, sellFloor, signBy, walletOf } from "./prepare-rules.ts";
import { type Ctx, LAUNCH_CU_LIMIT, liveStatus, networkFee } from "./status.ts";
import { tickerLock, tickerRefusal } from "./ticker.ts";
import { markUsed, reserve } from "./vanity.ts";

export {
  type GuardInput,
  parseRequest,
  prepareGuard,
  sellFloor,
  signBy,
  TABLE_CAP,
  WALLET_TABLE_CAP,
  walletOf,
} from "./prepare-rules.ts";

export type PrepareCtx = Ctx & { env: WorkerEnv };
// What reserve, the final message and finish read: no Q, so the genesis path (Q null, D-29) shares them.
type Chain = Pick<PrepareCtx, "conn" | "env" | "priorityFee">;

async function admit(ctx: PrepareCtx, body: unknown) {
  const raw = body as { wallet?: unknown; symbol?: unknown } | null;
  const wallet = walletOf(raw?.wallet);
  // An invalid symbol skips the lock read; prepareGuard refuses it as invalid_input.
  const sym = checkSymbol(String(raw?.symbol ?? ""));
  const free = { held: 0, until: null, lastLanded: null };
  const rows = wallet
    ? Promise.all([
        consented(db(), wallet),
        newTablesLastHour(db()),
        newTablesToday(db(), wallet),
        tableFor(db(), wallet),
        blocked(db(), wallet),
        sym.ok ? tickerLock(db(), sym.value, wallet) : free,
      ])
    : Promise.resolve([false, 0, 0, null, false, free] as const);
  const [status, [ok, tablesLastHour, walletTablesToday, prior, isBlocked, lock]] = await Promise.all([
    liveStatus(ctx, true),
    rows,
  ]);
  if (isBlocked) throw fail({ error: "blocked" }); // D-30: before every other guard and any build
  // D-40, D-44: before the caps, so a refused ticker spends no table quota, and before balance, mint and table.
  if (sym.ok && reservedTicker(sym.value)) throw fail({ error: "ticker_reserved" });
  const locked = tickerRefusal(lock, new Date());
  if (locked) throw fail(locked);
  const min = status.minLamports === null ? null : BigInt(status.minLamports);
  const refused = prepareGuard({
    paused: status.paused,
    min,
    consented: ok,
    body,
    tablesLastHour,
    walletTablesToday,
    reusable: !!prior,
  });
  if (refused) throw fail(refused);
  const req = parseRequest(body, min ?? 0n) as Req;
  return { req, prior, createCost: BigInt(status.createCostEstimate ?? 0) };
}

export async function reserveMint(ctx: Chain, wallet: string) {
  const mint = await reserve(db(), wallet);
  void startRefill(ctx.env);
  if (!mint) throw fail({ error: "pool_empty" });
  // Already on chain (a landed launch the DB missed): retired before ops pays a table for it (WR-04).
  if (await ctx.conn.getAccountInfo(new PublicKey(mint.pubkey))) {
    await markUsed(db(), mint.pubkey);
    console.error(`prepare retired vanity ${mint.idx}: its mint already exists on chain`);
    throw fail({ error: "build_failed" });
  }
  return mint;
}

// The creator fee is not set here: buildLaunch takes it from the live Global (creatorFeeFor, D-01).
function optsFor(ctx: PrepareCtx, req: Req, mint: string): LaunchOpts {
  return {
    ...{ name: req.name, symbol: req.symbol, uri: req.uri, online: ctx.online, Q: ctx.Q },
    mint: new PublicKey(mint),
    W: derive(ctx.env.seed, "w", ctx.env.net, mint).publicKey,
    dev: new PublicKey(req.wallet),
    solIn: new BN(req.solIn.toString()),
    exit: req.exit,
    cuLimit: LAUNCH_CU_LIMIT,
    priorityFee: ctx.priorityFee,
  };
}

export type Sized = { o: LaunchOpts; builds: Builds; table: AddressLookupTableAccount };

// Sell: the burn and sell probes give solBack, then the sell is rebuilt with its floor and simulated again.
// Exported for the fork rehearsal (spike genesis stage), which runs it without the database insert.
export async function finalMessage(ctx: Chain, s: Sized, blockhash: string) {
  const net = ctx.env.net;
  const fee = networkFee(ctx.priorityFee);
  const solIn = BigInt(s.o.solIn.toString());
  const tip = () => tipIxs(net, s.o.dev, feeConfig(net).launchTipLamports);
  const msgOf = (e: Exit) => compileLaunch({ ...s.o, exit: e }, s.builds[e].ixs, s.table, blockhash, tip());
  const sim = (msg: ReturnType<typeof msgOf>) => simulateLaunch(ctx.conn, msg, s.o.dev);
  // The simulated drop includes the tip when the message kept it (Pitfall 2): a fee, not create cost.
  const feeOf = (msg: ReturnType<typeof msgOf>) => fee + (tipped(msg) ? launchTip(net) : 0n);
  if (s.o.exit === "burn") {
    const msg = msgOf("burn");
    const costs = previewCosts(solIn, feeOf(msg), await sim(msg));
    return { msg, amount: s.builds.burn.amount, ...costs };
  }
  const probe = msgOf("burn");
  const [burnSpent, sellSpent] = await Promise.all([sim(probe), sim(msgOf("sell"))]);
  const costs = previewCosts(solIn, feeOf(probe), burnSpent, sellSpent);
  const minSolOut = new BN(sellFloor(costs.solBack ?? 0n).toString());
  const sell = await buildMessage({ ...s.o, minSolOut }, s.table, blockhash, tip());
  await sim(sell.msg);
  return { msg: sell.msg, amount: sell.amount, ...costs };
}

export function rowOf(req: Req, o: LaunchOpts, table: string, newTable: boolean): NewLaunch {
  const { wallet, name, symbol, description, links, imageCid, uri, solIn, exit } = req;
  const text = { name, symbol, description: description ?? null, links, imageCid, uri };
  return {
    wallet,
    mint: o.mint.toBase58(),
    w: o.W.toBase58(),
    ...text,
    solIn,
    exit,
    lookupTable: table,
    newTable,
  };
}

export async function finish(ctx: Chain, req: Req, s: Sized, created: boolean): Promise<PrepareResult> {
  const bh = await ctx.conn.getLatestBlockhash();
  const f = await finalMessage(ctx, s, bh.blockhash);
  const id = newId();
  const lastValidBlockHeight = BigInt(bh.lastValidBlockHeight);
  const stored = { message: Buffer.from(f.msg.serialize()), blockhash: bh.blockhash, lastValidBlockHeight };
  await insertPrepared(db(), id, { ...rowOf(req, s.o, s.table.key.toBase58(), created), ...stored });
  const wire = new VersionedTransaction(f.msg).serialize();
  const height = await ctx.conn.getBlockHeight();
  return {
    ...{
      launchId: id,
      tx: Buffer.from(wire).toString("base64"),
      mint: s.o.mint.toBase58(),
      bytes: wire.length,
    },
    signBy: signBy(bh.lastValidBlockHeight, height),
    preview: {
      createCost: String(f.createCost),
      networkFee: String(networkFee(ctx.priorityFee)),
      solBack: f.solBack === null ? null : String(f.solBack),
      tokensOut: f.amount.toString(),
    },
  };
}

async function prepareOne(ctx: PrepareCtx, body: unknown): Promise<PrepareResult> {
  const { req, prior, createCost } = await admit(ctx, body);
  // Before the reservation, so a wallet that cannot pay never holds a mint out of the pool (WR-01).
  const need = req.solIn + createCost + networkFee(ctx.priorityFee) + launchTip(ctx.env.net);
  const balance = await ctx.conn.getBalance(new PublicKey(req.wallet));
  if (BigInt(balance) < need) throw fail({ error: "insufficient_balance" });
  const mint = await reserveMint(ctx, req.wallet);
  const o = optsFor(ctx, req, mint.pubkey);
  const union = await unionTableKeys(o);
  // Same mint after an expired hold: its table still fits this wallet, so look it up by mint.
  const held = prior?.mint === mint.pubkey ? prior : await tableFor(db(), req.wallet, mint.pubkey);
  const reuse = held?.table ?? null;
  const t = await ensureTable(ctx.conn, ops(ctx.env.seed, ctx.env.net), union.keys, reuse, ctx.env.net);
  try {
    if (!t.table) throw fail({ error: "build_failed" }); // ensureTable logged why
    // A new table took about 5 s; price again so the probes do not run on stale amounts.
    const builds = t.created ? (await unionTableKeys(o)).builds : union.builds;
    return await finish(ctx, req, { o, builds, table: t.table }, t.created);
  } catch (e) {
    if (t.created) await recordPaid(rowOf(req, o, t.address, true), e);
    throw e;
  }
}

// Every table ops paid for gets a row, so the caps count it and its rent can be reclaimed (WR-02).
export async function recordPaid(row: NewLaunch, e: unknown): Promise<void> {
  const code = e instanceof Fail ? e.body.error : "build_failed";
  await insertFailed(db(), row, code).catch((err: unknown) =>
    console.error(
      `prepare could not record a paid table: ${redact(err instanceof Error ? err.message : String(err))}`,
    ),
  );
}

// ponytail: single-flight, because Helius free allows about 10 RPS and pace() is process-wide; per-wallet
// queues if launches get busy. The genesis builder (genesis.ts) runs in the same queue.
type One<C> = (ctx: C, body: unknown) => Promise<PrepareResult>;
let queue: Promise<unknown> = Promise.resolve();
export function prepare<C = PrepareCtx>(
  ctx: C,
  body: unknown,
  one = prepareOne as One<C>,
): Promise<PrepareResult> {
  const run = queue.then(() => one(ctx, body));
  queue = run.catch(() => undefined);
  return run;
}
