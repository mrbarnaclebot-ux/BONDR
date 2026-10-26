// POST /submit (LAUNCH-04, D-12): the dev-signed wire comes back from the browser and the worker adds the
// mint signature only if cosign passes against the stored message and the stored exit. Pause and expiry are
// re-checked here, server-side (Pattern 9). Nothing is sent unless every check passed.
import type { ApiError, Exit, LaunchState, SubmitResult } from "@bondr/core/api";
import { cosign, signatureOf } from "@bondr/core/cosign";
import { db } from "@bondr/core/db";
import { broadcast, type RawOpts } from "@bondr/core/send";
import { PublicKey, VersionedMessage } from "@solana/web3.js";
import { tipped } from "./build.ts";
import { feeConfig } from "./fee-config.ts";
import { urgentBroadcast } from "./fee-send.ts";
import { fail } from "./http.ts";
import { advance, getLaunch, type LaunchRow } from "./launches.ts";
import type { PrepareCtx } from "./prepare.ts";
import { releaseMint, settleInBackground } from "./settle.ts";
import { liveStatus } from "./status.ts";
import { mintKeyFor, vanityRow } from "./vanity.ts";

const SEND_PACE_MS = 1100;
const ID = /^[0-9a-f]{32}$/;
const MAX_WIRE = 1232;

function parse(body: unknown): { launchId: string; wire: Uint8Array } {
  const b = (body ?? {}) as Record<string, unknown>;
  const ok = typeof b.launchId === "string" && ID.test(b.launchId) && typeof b.signed === "string";
  const wire = ok ? Buffer.from(b.signed as string, "base64") : Buffer.alloc(0);
  if (!wire.length || wire.length > MAX_WIRE) throw fail({ error: "invalid_input" });
  return { launchId: b.launchId as string, wire };
}

const current = (row: LaunchRow): SubmitResult => ({
  state: row.state as LaunchState,
  ...(row.signature && { signature: row.signature }),
});

// Fails a prepared row with the contract error. A refused co-sign keeps the reservation, so Try again
// reuses the mint and its table. A concurrent submit that signed the row first wins: its state is the answer,
// never a refusal that would tell the dev nothing was sent (web WR-05).
async function refuse(row: LaunchRow, body: ApiError, keepMint = false): Promise<SubmitResult> {
  const failed = await advance(db(), row.id, "prepared", "failed", { error: body.error });
  if (!failed) return current((await getLaunch(db(), row.id)) ?? row);
  if (!keepMint) await releaseMint(row.mint);
  throw fail(body);
}

// The message, the exit and the mint all come from the stored row; the request supplies only the wire.
async function cosignRow(ctx: PrepareCtx, row: LaunchRow, wire: Uint8Array): Promise<Uint8Array | null> {
  if (!row.message || !row.lookupTable) throw fail({ error: "build_failed" });
  const [table, vanity] = await Promise.all([
    ctx.conn.getAddressLookupTable(new PublicKey(row.lookupTable)),
    vanityRow(db(), row.mint),
  ]);
  if (!table.value || !vanity) throw fail({ error: "build_failed" });
  const mint = mintKeyFor(vanity, ctx.env.seed, ctx.env.net, ctx.env.lane);
  const stored = { stored: row.message, dev: row.wallet, mint, exit: row.exit as Exit };
  const r = cosign({ wire, ...stored, tables: [table.value] });
  if (r.ok) return r.wire;
  console.warn(`submit ${row.id} refused: ${r.reason}`);
  return null;
}

// Only mainnet prepares tipped messages (D-34). Sender answers "unknown" on any error, even when nothing went out,
// so the same bytes go once through RPC: they carry the same signature, so the chain executes them at most once.
async function broadcastLaunch(ctx: PrepareCtx, row: LaunchRow, wire: Uint8Array, o: RawOpts) {
  if (!row.message || !tipped(VersionedMessage.deserialize(row.message))) return broadcast(ctx.conn, wire, o);
  const net = ctx.env.net;
  const swqosOnly = feeConfig(net).launchTipLamports < 1_000_000; // Pitfall 10
  const r = await urgentBroadcast(net, ctx.conn, wire, { ...o, swqosOnly });
  if (r?.status !== "unknown" || !r.err?.startsWith("sender")) return r;
  console.warn(`submit ${row.id}: ${r.err}, sending the same bytes over RPC`);
  return broadcast(ctx.conn, wire, o);
}

// signed is persisted before the send, so a restart can resend the same wire (Pattern 8).
async function send(ctx: PrepareCtx, row: LaunchRow, wire: Uint8Array): Promise<SubmitResult> {
  const signature = signatureOf(wire);
  const signed = await advance(db(), row.id, "prepared", "signed", {
    signedTx: Buffer.from(wire),
    signature,
  });
  if (!signed) return current((await getLaunch(db(), row.id)) ?? row);
  const lastValidBlockHeight = Number(row.lastValidBlockHeight);
  const base = { sig: signature, bytes: wire.length, blockhash: row.blockhash ?? "", lastValidBlockHeight };
  const r = await broadcastLaunch(ctx, row, wire, { ...base, paceMs: SEND_PACE_MS });
  if (r?.status === "failed") {
    if (await advance(db(), row.id, "signed", "failed", { error: r.err ?? "preflight rejected" }))
      await releaseMint(row.mint);
    return { state: "failed", signature };
  }
  // Accepted, or a throw after which it may have gone out: both are settled by status, never resent (D-16).
  const sent = await advance(db(), row.id, "signed", "sent");
  settleInBackground(ctx.conn, sent ?? signed);
  return { state: "sent", signature };
}

export async function submit(ctx: PrepareCtx, body: unknown): Promise<SubmitResult> {
  const { launchId, wire } = parse(body);
  const row = await getLaunch(db(), launchId);
  if (!row) throw fail({ error: "not_found" });
  if (row.state !== "prepared") return current(row);
  const { paused, minLamports } = await liveStatus(ctx, true);
  if (paused) return refuse(row, { error: "paused", paused });
  // No chain read means the awaiting-migration pause could not be checked: refuse, never co-sign blind (IN-02).
  // The mint is kept, so Try again reuses it once the RPC answers.
  if (minLamports === null) return refuse(row, { error: "build_failed" }, true);
  if ((await ctx.conn.getBlockHeight()) > Number(row.lastValidBlockHeight))
    return refuse(row, { error: "expired" });
  const cosigned = await cosignRow(ctx, row, wire);
  if (!cosigned) return refuse(row, { error: "cosign_refused" }, true);
  return send(ctx, row, cosigned);
}
