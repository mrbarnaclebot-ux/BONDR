// The send half of a trade (TRADE-01, TRADE-02): only the exact message prepare stored, signed by its wallet,
// goes out on the worker's Helius key, once (T3). A raw byte compare, never a re-serialization. Settle runs in
// the background and the browser reads the outcome through viewTrade.
import type { TradeErrorCode, TradeView } from "@bondr/core/api";
import { sameMessage, signatureOf, signatureOk, slot } from "@bondr/core/cosign";
import { redact } from "@bondr/core/net";
import { broadcast, fetchTx, settle } from "@bondr/core/send";
import { lamportDelta, soldLamports, tokenDelta } from "@bondr/core/trade";
import { textError } from "@bondr/core/trade-error";
import { type Connection, PublicKey } from "@solana/web3.js";
import { fail } from "./http.ts";
import { walletOf } from "./prepare.ts";
import { getTrade, type TradeEntry, updateTrade } from "./trade-store.ts";

const SEND_PACE_MS = 1100;
const ID = /^[0-9a-f]{32}$/;
const MAX_WIRE = 1232;
const SLIPPAGE = 6004;

type Req = { tradeId: string; wallet: string };
type SubmitCtx = { conn: Connection; Q: PublicKey };
type LandedTx = NonNullable<Awaited<ReturnType<typeof fetchTx>>>;

function parseReq(body: unknown): Req {
  const b = (body ?? {}) as Record<string, unknown>;
  const wallet = walletOf(b.wallet);
  if (typeof b.tradeId !== "string" || !ID.test(b.tradeId) || !wallet) throw fail({ error: "invalid_input" });
  return { tradeId: b.tradeId, wallet };
}

function parseWire(body: unknown): Uint8Array {
  const signed = (body as { signed?: unknown } | null)?.signed;
  const wire = typeof signed === "string" ? Buffer.from(signed, "base64") : Buffer.alloc(0);
  if (!wire.length || wire.length > MAX_WIRE) throw fail({ error: "invalid_input" });
  return wire;
}

// Bound to the wallet that prepared it: anyone else gets the same answer as a missing or swept id (T5).
function owned(r: Req): TradeEntry {
  const e = getTrade(r.tradeId);
  if (!e || e.wallet !== r.wallet) throw fail({ error: "not_found" });
  return e;
}

const view = (e: TradeEntry): TradeView => ({
  state: e.state,
  ...(e.signature && { signature: e.signature }),
  ...(e.amountOut && { amountOut: e.amountOut }),
  ...(e.code && { code: e.code }),
});

const finish = (e: TradeEntry, code: TradeErrorCode): TradeView =>
  view(updateTrade(e.id, { state: "failed", code }) ?? e);

const logged = (id: string) => (e: unknown) =>
  console.error(`trade settle ${id} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

// A buy's coin delta has no rent in it; a sell reads its BONDR to SOL leg's event, since the wallet's SOL delta
// counts the rent of every ATA the tx closed or opened (S-CR-01).
const landedOut = (ctx: SubmitCtx, e: TradeEntry, tx: LandedTx): bigint => {
  const wallet = new PublicKey(e.wallet);
  if (e.side === "buy") return tokenDelta(tx.meta, new PublicKey(e.mint), wallet);
  return soldLamports(tx, ctx.Q, wallet) ?? lamportDelta(tx.meta);
};

// One extra getTransaction for the landed amounts.
// ponytail: one more credit per trade; return the tx from settle if credits ever matter.
async function settleTrade(ctx: SubmitCtx, e: TradeEntry, sig: string, bytes: number): Promise<void> {
  const r = await settle(ctx.conn, sig, bytes, false, e);
  // Never resent (D-16): unknown keeps its signature so the result line links it on Solscan (T8).
  if (r.status === "unknown") return void updateTrade(e.id, { state: "unknown" });
  if (r.status === "failed") return void finish(e, r.code === SLIPPAGE ? "slippage" : "onchain");
  const tx = await fetchTx(ctx.conn, sig);
  updateTrade(e.id, { state: "landed", ...(tx && { amountOut: landedOut(ctx, e, tx).toString() }) });
}

// signed is set before the send, synchronously after the checks, so a concurrent submit only reads.
async function send(ctx: SubmitCtx, e: TradeEntry, wire: Uint8Array): Promise<TradeView> {
  const signature = signatureOf(wire);
  updateTrade(e.id, { state: "signed", signature });
  const o = { sig: signature, bytes: wire.length, blockhash: e.blockhash, paceMs: SEND_PACE_MS };
  const r = await broadcast(ctx.conn, wire, { ...o, lastValidBlockHeight: e.lastValidBlockHeight });
  // Preflight rejected it, so nothing went out.
  if (r?.status === "failed") return finish(e, textError(r.err ?? "").error);
  // Accepted, or a throw after which it may have gone out: both are settled by status, never resent.
  const sent = updateTrade(e.id, { state: "sent" });
  void settleTrade(ctx, e, signature, wire.length).catch(logged(e.id));
  return view(sent ?? e);
}

export async function submitTrade(ctx: SubmitCtx, body: unknown): Promise<TradeView> {
  const req = parseReq(body);
  const wire = parseWire(body);
  if (owned(req).state !== "prepared") return view(owned(req)); // a repeat submit is a read
  const height = await ctx.conn.getBlockHeight();
  const e = owned(req); // again: a concurrent submit may have moved it during the await
  if (e.state !== "prepared") return view(e);
  if (height > e.lastValidBlockHeight) {
    finish(e, "expired");
    throw fail({ error: "expired" });
  }
  if (!sameMessage(e.message, wire, 1) || !signatureOk(e.message, slot(wire, 0), e.wallet)) {
    finish(e, "message_changed");
    throw fail({ error: "message_changed" });
  }
  return send(ctx, e, wire);
}

export const viewTrade = (body: unknown): TradeView => view(owned(parseReq(body)));
