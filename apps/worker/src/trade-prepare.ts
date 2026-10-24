// The build half of a trade (TRADE-01, TRADE-02): a validated buy or sell becomes one unsigned, simulated,
// compute-budgeted v0 transaction the wallet signs once, and its exact bytes are kept for submit (Pitfall 3).
// The message holds only the compute budget and the multi_hop_swap route, so BONDR takes no fee (TRADE-04);
// routeOnly checks that on every build.
// Its own path, not the launch prepare one, which waits behind 10-18 s launch builds (RESEARCH anti-pattern).
import type { ApiError, TradePrepareResult } from "@bondr/core/api";
import { MULTI_HOP_SWAP } from "@bondr/core/cosign";
import { redact } from "@bondr/core/net";
import { BN, PUMP_AMM_PROGRAM_ID } from "@bondr/core/pump";
import { routeBuy, routeSell } from "@bondr/core/route";
import { budget, checkMessage, messageSize, PACKET_LIMIT } from "@bondr/core/send";
import { textError, tradeError } from "@bondr/core/trade-error";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  type VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { fail } from "./http.ts";
import { signBy, walletOf } from "./prepare.ts";
import type { Ctx } from "./status.ts";
import { MAX_PRIORITY_LAMPORTS, maxSolIn, parseTrade, type TradeNet, type TradeReq } from "./trade-quote.ts";
import { configs, mintState } from "./trade-state.ts";
import { putTrade } from "./trade-store.ts";

export type TradeCtx = Ctx & { net: TradeNet };

const SIM_CU = 1_400_000;
const ESTIMATE_TIMEOUT_MS = 3_000;

// Integer math: units * 1.1 in floats rounds 10 up to 12.
export const cuLimitFor = (units: number): number => Math.ceil((units * 11) / 10);

const capFor = (cuLimit: number, price: number): number =>
  Math.max(0, Math.min(Math.floor(price), Math.floor((MAX_PRIORITY_LAMPORTS * 1e6) / cuLimit)));

// Helius devnet answers getPriorityFeeEstimate with Method not found (Pitfall 2), so only mainnet asks.
export async function priorityMicroLamports(
  net: TradeNet,
  estimate: () => Promise<number>,
  fallback: number,
  cuLimit: number,
): Promise<number> {
  let price = fallback;
  if (net === "mainnet")
    price = await estimate().catch((e: unknown) => {
      console.error(`priority estimate failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      return fallback;
    });
  return capFor(cuLimit, Number.isFinite(price) ? price : fallback);
}

async function heliusEstimate(conn: Connection, ixs: TransactionInstruction[]): Promise<number> {
  const keys = new Set(
    ixs.flatMap((ix) => ix.keys.filter((k) => k.isWritable).map((k) => k.pubkey.toBase58())),
  );
  const res = await fetch(conn.rpcEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getPriorityFeeEstimate",
      params: [{ accountKeys: [...keys], options: { priorityLevel: "Medium" } }],
    }),
    signal: AbortSignal.timeout(ESTIMATE_TIMEOUT_MS),
  });
  const j = (await res.json()) as {
    result?: { priorityFeeEstimate?: unknown };
    error?: { message?: string };
  };
  const fee = j.result?.priorityFeeEstimate;
  if (typeof fee !== "number") throw new Error(j.error?.message ?? `estimate HTTP ${res.status}`);
  return fee;
}

// A build_failed carries no detail to web; the reason goes to the log through redact (T9).
function refuse(out: ApiError, why: string) {
  if (out.error === "build_failed") console.error(`trade prepare failed: ${redact(why)}`);
  return fail(out);
}

// Pitfall 4, S-WR-04: on devnet, while BONDR is on its curve, a buy past maxSolIn would complete BONDR's shared
// curve or the coin's own. Both states are the quote's cached reads.
async function capDevnetBuy(ctx: TradeCtx, req: TradeReq): Promise<void> {
  if (ctx.net !== "devnet" || req.side !== "buy") return;
  const [cfg, bondr, coin] = await Promise.all([
    configs(ctx),
    mintState(ctx, ctx.Q, NATIVE_MINT),
    mintState(ctx, req.mint, ctx.Q),
  ]);
  const max = maxSolIn(ctx.net, bondr, coin, cfg);
  if (max !== undefined && req.amount > BigInt(max)) throw fail({ error: "invalid_input" });
}

async function routeFor(ctx: TradeCtx, req: TradeReq, user: PublicKey) {
  const buy = req.side === "buy";
  const path = buy ? [NATIVE_MINT, ctx.Q, req.mint] : [req.mint, ctx.Q, NATIVE_MINT];
  const opts = {
    online: ctx.online,
    path,
    user,
    amountIn: new BN(req.amount.toString()),
    slippageBps: req.slippageBps,
  };
  try {
    return await (buy ? routeBuy(opts) : routeSell(opts));
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    throw refuse(textError(text), text);
  }
}

const [CU, SYSTEM, ATA, TOKEN, AMM] = [
  ComputeBudgetProgram.programId,
  SystemProgram.programId,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
].map((k) => k.toBase58());
const [TRANSFER, CREATE_IDEMPOTENT, CLOSE_ACCOUNT, SYNC_NATIVE] = [2, 1, 9, 17];

// What multiHopSwapInstructions builds around the swap: idempotent ATA creates the user pays for, and the
// wrap, sync and close of the user's own WSOL account. A System transfer anywhere else is a fee.
// ponytail: an ATA create for another owner (the buyback ATA) is allowed; its rent is the only leak.
function routeIx(p: string, d: Buffer, acc: string[], me: string, wsol: string): boolean {
  if (p === SYSTEM)
    return d.length === 12 && d.readUInt32LE(0) === TRANSFER && acc.join() === `${me},${wsol}`;
  if (p === ATA) return d.length === 1 && d[0] === CREATE_IDEMPOTENT && acc[0] === me;
  if (p !== TOKEN || acc[0] !== wsol || d.length !== 1) return false;
  return d[0] === SYNC_NATIVE || (d[0] === CLOSE_ACCOUNT && acc[1] === me);
}

// TRADE-04 at runtime (S-WR-03): the two budget ixs first, then the route with exactly one multi_hop_swap.
// An SDK bump that adds a fee transfer or another program fails the build, not a friend's wallet.
export function routeOnly(msg: VersionedMessage, user: PublicKey): string | null {
  const keys = msg.staticAccountKeys.map((k) => k.toBase58());
  const [me, wsol] = [user.toBase58(), getAssociatedTokenAddressSync(NATIVE_MINT, user, true).toBase58()];
  let swaps = 0;
  for (const [i, ix] of msg.compiledInstructions.entries()) {
    const p = keys[ix.programIdIndex] ?? "missing";
    const d = Buffer.from(ix.data);
    if ((p === CU) !== i < 2) return `compute budget ix at ${i}`;
    if (p === CU) continue;
    if (p === AMM && d.subarray(0, 8).equals(MULTI_HOP_SWAP)) swaps++;
    else if (
      !routeIx(
        p,
        d,
        ix.accountKeyIndexes.map((k) => keys[k] ?? ""),
        me,
        wsol,
      )
    )
      return `ix ${i} (${p}) is not part of the route`;
  }
  return swaps === 1 ? null : `${swaps} multi_hop_swap ixs`;
}

const compile = (payer: PublicKey, ixs: TransactionInstruction[], blockhash: string) =>
  new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message();

// The route with the real minAmountOut, simulated as the user: a price move since the route's own simulation
// surfaces here as 6004, not on chain. Returns the units consumed.
async function simulate(ctx: TradeCtx, user: PublicKey, ixs: TransactionInstruction[]): Promise<number> {
  const msg = compile(
    user,
    [...budget(SIM_CU, capFor(SIM_CU, ctx.priorityFee)), ...ixs],
    PublicKey.default.toBase58(),
  );
  const sim = await ctx.conn.simulateTransaction(new VersionedTransaction(msg), {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  const { err, logs, unitsConsumed } = sim.value;
  if (err !== null) throw refuse(tradeError(err, logs), `${JSON.stringify(err)} ${(logs ?? []).slice(-6)}`);
  if (!unitsConsumed) throw refuse({ error: "build_failed" }, "simulation returned no units");
  return unitsConsumed;
}

export async function prepareTrade(ctx: TradeCtx, body: unknown): Promise<TradePrepareResult> {
  const req = parseTrade(body, ctx.Q);
  const wallet = walletOf((body as { wallet?: unknown } | null)?.wallet);
  if (!wallet) throw fail({ error: "invalid_input" });
  const user = new PublicKey(wallet);
  await capDevnetBuy(ctx, req);
  const r = await routeFor(ctx, req, user);
  const cuLimit = cuLimitFor(await simulate(ctx, user, r.ixs));
  const price = await priorityMicroLamports(
    ctx.net,
    () => heliusEstimate(ctx.conn, r.ixs),
    ctx.priorityFee,
    cuLimit,
  );
  const bh = await ctx.conn.getLatestBlockhash();
  // One compile after the blockhash: these exact bytes are stored and returned (Pitfall 3).
  const msg = compile(user, [...budget(cuLimit, price), ...r.ixs], bh.blockhash);
  const refused = checkMessage(msg) ?? routeOnly(msg, user);
  if (refused) throw refuse({ error: "build_failed" }, refused);
  if (messageSize(msg) > PACKET_LIMIT) throw refuse({ error: "build_failed" }, `${messageSize(msg)} bytes`);
  const side = req.side;
  const stored = { wallet, mint: req.mint.toBase58(), side, message: Buffer.from(msg.serialize()) };
  const e = putTrade({ ...stored, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight });
  const height = await ctx.conn.getBlockHeight();
  return {
    tradeId: e.id,
    tx: Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64"),
    signBy: signBy(bh.lastValidBlockHeight, height),
    expectedOut: r.expectedOut.toString(),
    minAmountOut: r.minAmountOut.toString(),
  };
}
