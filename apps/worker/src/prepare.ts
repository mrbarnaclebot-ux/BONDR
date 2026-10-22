// POST /prepare (LAUNCH-03, FEE-10): the unsigned launch tx, built only where the seed lives. Every cheap
// guard runs before ops spends table rent (Pitfall 5); the exact message bytes are stored for the byte
// compare at submit (Pattern 3, sign order A).
import type { ApiError, Exit, Links, PauseReason, PrepareRequest, PrepareResult } from "@bondr/core/api";
import { db } from "@bondr/core/db";
import { derive } from "@bondr/core/keys";
import type { LaunchOpts } from "@bondr/core/launch";
import { applyBps } from "@bondr/core/math";
import { BN } from "@bondr/core/pump";
import {
  checkDescription,
  checkDevBuy,
  checkName,
  checkSymbol,
  checkUri,
  normalizeLink,
} from "@bondr/core/rules";
import { type AddressLookupTableAccount, PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  type Builds,
  buildMessage,
  compileLaunch,
  ensureTable,
  previewCosts,
  simulateLaunch,
  unionTableKeys,
} from "./build.ts";
import { ops, type WorkerEnv } from "./env.ts";
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
import { type Ctx, LAUNCH_CU_LIMIT, liveStatus, MAX_SOL_IN, networkFee } from "./status.ts";
import { reserve } from "./vanity.ts";

export type PrepareCtx = Ctx & { env: WorkerEnv };
type Req = Omit<PrepareRequest, "solIn"> & { solIn: bigint };

// New per-coin tables per hour, worker-wide: at about 0.006 SOL each, a cap on how fast prepare spam drains ops.
export const TABLE_CAP = 30;
// New tables per wallet per day: each coin needs its own table, so this is also a launch cap per wallet. It
// stops one proven wallet from spending the whole hourly cap (CR-01).
export const WALLET_TABLE_CAP = 10;
const SELL_SLIPPAGE_BPS = 300;
const CID = /^[A-Za-z0-9]{1,100}$/;
const LINK_KINDS = ["x", "telegram", "website"] as const;

function walletOf(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 44) return null;
  try {
    return new PublicKey(raw).toBase58() === raw ? raw : null;
  } catch {
    return null;
  }
}

function linksOf(raw: unknown): Links | null {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object") return null;
  const out: Links = {};
  for (const kind of LINK_KINDS) {
    const v = (raw as Record<string, unknown>)[kind];
    if (v === undefined) continue;
    const r = typeof v === "string" ? normalizeLink(kind, v) : null;
    if (!r?.ok) return null;
    if (r.value) out[kind] = r.value;
  }
  return out;
}

function lamportsOf(raw: unknown, min: bigint): bigint | null {
  if (typeof raw !== "string" || !/^\d{1,20}$/.test(raw)) return null;
  const n = BigInt(raw);
  return n <= MAX_SOL_IN && checkDevBuy(n, min).ok ? n : null;
}

// The same rules as the browser and web (rules.ts), run again here: the worker trusts nothing it is sent.
export function parseRequest(body: unknown, min: bigint): Req | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const [name, symbol, uri] = [checkName(s("name")), checkSymbol(s("symbol")), checkUri(s("uri"))];
  const description = checkDescription(s("description"));
  const [wallet, links, solIn] = [walletOf(b.wallet), linksOf(b.links), lamportsOf(b.solIn, min)];
  const exit: Exit | null = b.exit === "burn" || b.exit === "sell" ? b.exit : null;
  if (!name.ok || !symbol.ok || !uri.ok || !description.ok || !CID.test(s("imageCid"))) return null;
  if (!wallet || !links || solIn === null || !exit) return null;
  const desc = description.value || undefined;
  const base = { wallet, name: name.value, symbol: symbol.value, uri: uri.value, links, solIn, exit };
  return { ...base, imageCid: s("imageCid"), ...(desc && { description: desc }) };
}

export type GuardInput = {
  paused: PauseReason | null;
  min: bigint | null; // null: the live config could not be read
  consented: boolean;
  body: unknown;
  tablesLastHour: number;
  walletTablesToday: number;
  reusable: boolean; // the wallet's live reservation already has a table
};

export function prepareGuard(i: GuardInput): ApiError | null {
  if (i.paused) return { error: "paused", paused: i.paused };
  if (i.min === null) return { error: "build_failed" };
  if (!parseRequest(i.body, i.min)) return { error: "invalid_input" };
  if (!i.consented) return { error: "consent_required" };
  const capped = i.tablesLastHour >= TABLE_CAP || i.walletTablesToday >= WALLET_TABLE_CAP;
  if (capped && !i.reusable) return { error: "rate_limited" };
  return null;
}

// Seconds left to sign at about 0.4 s per block, capped at 60 (Pitfall 3).
export const signBy = (lastValidBlockHeight: number, height: number): number =>
  Math.min(60, Math.max(0, Math.floor((lastValidBlockHeight - height) * 0.4)));

// The insta-sell floor: the simulated SOL back less 3%, never the 1-lamport default (T-02-11-05).
export function sellFloor(solBack: bigint): bigint {
  const floor = applyBps(solBack, 10_000 - SELL_SLIPPAGE_BPS);
  return floor > 0n ? floor : 1n;
}

async function admit(ctx: PrepareCtx, body: unknown) {
  const wallet = walletOf((body as { wallet?: unknown } | null)?.wallet);
  const rows = wallet
    ? Promise.all([
        consented(db(), wallet),
        newTablesLastHour(db()),
        newTablesToday(db(), wallet),
        tableFor(db(), wallet),
      ])
    : Promise.resolve([false, 0, 0, null] as const);
  const [status, [ok, tablesLastHour, walletTablesToday, prior]] = await Promise.all([liveStatus(ctx), rows]);
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

async function reserveMint(ctx: PrepareCtx, wallet: string) {
  const mint = await reserve(db(), wallet);
  void startRefill(ctx.env);
  if (!mint) throw fail({ error: "pool_empty" });
  return mint;
}

async function optsFor(ctx: PrepareCtx, req: Req, mint: string): Promise<LaunchOpts> {
  const g = await ctx.online.fetchGlobal();
  return {
    ...{ name: req.name, symbol: req.symbol, uri: req.uri, online: ctx.online, Q: ctx.Q },
    mint: new PublicKey(mint),
    W: derive(ctx.env.seed, "w", ctx.env.net, mint).publicKey,
    dev: new PublicKey(req.wallet),
    solIn: new BN(req.solIn.toString()),
    exit: req.exit,
    // D-01: BONDR's rate only where the live Global allows a per-coin rate; devnet runs pump's default.
    creatorFeeBps: g.creatorFeeConfigurable ? new BN(150) : undefined,
    cuLimit: LAUNCH_CU_LIMIT,
    priorityFee: ctx.priorityFee,
  };
}

type Sized = { o: LaunchOpts; builds: Builds; table: AddressLookupTableAccount };

// Sell: the burn and sell probes give solBack, then the sell is rebuilt with its floor and simulated again.
async function finalMessage(ctx: PrepareCtx, s: Sized, blockhash: string) {
  const fee = networkFee(ctx.priorityFee);
  const solIn = BigInt(s.o.solIn.toString());
  const msgOf = (e: Exit) => compileLaunch({ ...s.o, exit: e }, s.builds[e].ixs, s.table, blockhash);
  const sim = (msg: ReturnType<typeof msgOf>) => simulateLaunch(ctx.conn, msg, s.o.dev);
  if (s.o.exit === "burn") {
    const msg = msgOf("burn");
    const costs = previewCosts(solIn, fee, await sim(msg));
    return { msg, amount: s.builds.burn.amount, ...costs };
  }
  const [burnSpent, sellSpent] = await Promise.all([sim(msgOf("burn")), sim(msgOf("sell"))]);
  const costs = previewCosts(solIn, fee, burnSpent, sellSpent);
  const minSolOut = new BN(sellFloor(costs.solBack ?? 0n).toString());
  const sell = await buildMessage({ ...s.o, minSolOut }, s.table, blockhash);
  await sim(sell.msg);
  return { msg: sell.msg, amount: sell.amount, ...costs };
}

function rowOf(req: Req, o: LaunchOpts, table: string, newTable: boolean): NewLaunch {
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

async function finish(ctx: PrepareCtx, req: Req, s: Sized, created: boolean): Promise<PrepareResult> {
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
  const need = req.solIn + createCost + networkFee(ctx.priorityFee);
  const balance = await ctx.conn.getBalance(new PublicKey(req.wallet));
  if (BigInt(balance) < need) throw fail({ error: "insufficient_balance" });
  const mint = await reserveMint(ctx, req.wallet);
  const o = await optsFor(ctx, req, mint.pubkey);
  const union = await unionTableKeys(o);
  // Same mint after an expired hold: its table still fits this wallet, so look it up by mint.
  const held = prior?.mint === mint.pubkey ? prior : await tableFor(db(), req.wallet, mint.pubkey);
  const reuse = held?.table ?? null;
  const { table, created } = await ensureTable(ctx.conn, ops(ctx.env.seed, ctx.env.net), union.keys, reuse);
  // A new table took about 5 s; price again so the probes do not run on stale amounts.
  const builds = created ? (await unionTableKeys(o)).builds : union.builds;
  try {
    return await finish(ctx, req, { o, builds, table }, created);
  } catch (e) {
    const row = rowOf(req, o, table.key.toBase58(), true);
    const code = e instanceof Fail ? e.body.error : "build_failed";
    if (created) await insertFailed(db(), row, code).catch(() => undefined);
    throw e;
  }
}

// ponytail: single-flight, because Helius free allows about 10 RPS and pace() is process-wide; per-wallet
// queues if launches get busy.
let queue: Promise<unknown> = Promise.resolve();
export function prepare(ctx: PrepareCtx, body: unknown): Promise<PrepareResult> {
  const run = queue.then(() => prepareOne(ctx, body));
  queue = run.catch(() => undefined);
  return run;
}
