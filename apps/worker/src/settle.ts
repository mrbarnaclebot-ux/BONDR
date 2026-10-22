// Settles a sent launch (RESEARCH Pattern 8). Landed is recorded the moment the signature confirms, because
// the client polls the row every second (LAUNCH-05); facts follow. D-16: an unseen launch is never resent;
// past its blockhash it is rechecked with history and only then failed.
import { setTimeout as delay } from "node:timers/promises";
import type { LaunchState } from "@bondr/core/api";
import { db } from "@bondr/core/db";
import { innerEvents } from "@bondr/core/events";
import { redact } from "@bondr/core/net";
import { broadcast, fetchTx } from "@bondr/core/send";
import type { Connection } from "@solana/web3.js";
import { advance, type LaunchRow, unsettled } from "./launches.ts";
import { markUsed, release, vanityRow } from "./vanity.ts";

const POLL_MS = 400;
const RECHECK_MS = 10_000;
const RECHECKS = 3;
// Block height every 5th poll (2 s): expiry is a 60-90 s matter, and Helius free allows about 10 RPS.
const HEIGHT_EVERY = 5;
const SEND_PACE_MS = 1100;

export type Seen = { confirmed: boolean; err: unknown } | null;
export type Next =
  | { to: "landed" }
  | { to: "failed"; error: string }
  | { to: "poll" }
  | { to: "recheck" }
  | { to: "unknown" };
type Obs = { seen: Seen; height: number; lastValid: number; rechecks: number; rpcError?: boolean };

export function nextState(o: Obs): Next {
  if (o.seen?.confirmed)
    return o.seen.err === null
      ? { to: "landed" }
      : { to: "failed", error: `onchain ${JSON.stringify(o.seen.err)}` };
  if (o.height <= o.lastValid) return { to: "poll" };
  if (o.rpcError) return { to: "unknown" };
  return o.rechecks >= RECHECKS ? { to: "failed", error: "expired" } : { to: "recheck" };
}

// A signed row may never have gone out, so it is resent while its blockhash is valid: same wire, same
// signature, Solana dedupes. Everything else is only checked (D-16).
export const resumeAction = (state: LaunchState, blockhashValid: boolean): "resend" | "check" =>
  state === "signed" && blockhashValid ? "resend" : "check";

type Row = Pick<LaunchRow, "id" | "state" | "signature" | "lastValidBlockHeight" | "mint" | "wallet"> &
  Pick<LaunchRow, "exit" | "solIn">;

export async function releaseMint(mint: string): Promise<void> {
  const v = await vanityRow(db(), mint);
  if (v) await release(db(), v.idx, "failed");
}

async function observe(conn: Connection, sig: string, history: boolean, height: number | null) {
  try {
    const st = (await conn.getSignatureStatuses([sig], { searchTransactionHistory: history })).value[0];
    const done = st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
    const seen: Seen = st ? { confirmed: done, err: st.err } : null;
    return { seen, height: done || height !== null ? height : await conn.getBlockHeight() };
  } catch {
    return { seen: null, height, rpcError: true };
  }
}

// Facts from the landed tx: tokens bought, dev child balance after, and for sell the SOL back, which is the
// dev's lamport change plus what the dev spent (solIn, fee, and the rent of every account the tx created).
export function launchFacts(
  tx: NonNullable<Awaited<ReturnType<typeof fetchTx>>>,
  row: Pick<Row, "mint" | "wallet" | "exit" | "solIn">,
) {
  const buy = innerEvents(tx).find(
    (e) => e.name === "TradeEvent" && e.data.mint === row.mint && e.data.isBuy,
  );
  const held = tx.meta.postTokenBalances?.find((b) => b.mint === row.mint && b.owner === row.wallet);
  const facts: { tokens?: string; solBack?: string; devChildAfter: string } = {
    devChildAfter: held?.uiTokenAmount.amount ?? "0",
    ...(buy && { tokens: String(buy.data.tokenAmount) }),
  };
  if (row.exit !== "sell") return facts;
  const { preBalances: pre, postBalances: post, fee } = tx.meta;
  const rent = post.reduce((sum, p, i) => sum + (pre[i] === 0 ? BigInt(p) : 0n), 0n);
  const delta = BigInt(post[0] ?? 0) - BigInt(pre[0] ?? 0);
  return { ...facts, solBack: String(delta + row.solIn + BigInt(fee) + rent) };
}

async function landed(conn: Connection, row: Row): Promise<void> {
  // One transaction: a landed mint is never left free in the pool by a failed second write (WR-04).
  const moved = await db().transaction(async (tx) => {
    const r = await advance(tx, row.id, row.state as LaunchState, "landed", { landedAt: new Date() });
    if (r) await markUsed(tx, row.mint);
    return r;
  });
  if (!moved) return;
  const tx = await fetchTx(conn, row.signature ?? "");
  if (tx) await advance(db(), row.id, "landed", "landed", { facts: launchFacts(tx, row) });
}

async function conclude(conn: Connection, row: Row, next: Next): Promise<void> {
  const from = row.state as LaunchState;
  if (next.to === "landed") return landed(conn, row);
  if (next.to === "failed") {
    if (await advance(db(), row.id, from, "failed", { error: next.error })) await releaseMint(row.mint);
    return;
  }
  // RPC down past expiry: left unknown for the next boot's recheck, never resent.
  if (from !== "unknown") await advance(db(), row.id, from, "unknown", { error: "status unknown" });
}

export async function settleLaunch(conn: Connection, row: Row): Promise<void> {
  const lastValid = Number(row.lastValidBlockHeight);
  let [height, rechecks] = [0, 0];
  for (let i = 0; ; i++) {
    const fresh = i % HEIGHT_EVERY === 0 || rechecks > 0;
    const o = await observe(conn, row.signature ?? "", rechecks > 0, fresh ? null : height);
    height = o.height ?? height;
    const next = nextState({ ...o, height, lastValid, rechecks });
    if (next.to === "poll") await delay(POLL_MS);
    else if (next.to === "recheck") {
      rechecks += 1;
      await delay(RECHECK_MS);
    } else return conclude(conn, row, next);
  }
}

const logged = (id: string) => (e: unknown) =>
  console.error(`settle ${id} failed: ${redact(e instanceof Error ? e.message : String(e))}`);

export function settleInBackground(conn: Connection, row: Row): void {
  void settleLaunch(conn, row).catch(logged(row.id));
}

// On boot. A resend's outcome is ignored on purpose: "already processed" also fails preflight, so only the
// signature status decides landed or failed.
export async function resumeLaunches(conn: Connection): Promise<void> {
  const rows = await unsettled(db());
  if (!rows.length) return;
  const height = await conn.getBlockHeight();
  for (const row of rows) {
    let state = row.state as LaunchState;
    const valid = height <= Number(row.lastValidBlockHeight);
    if (resumeAction(state, valid) === "resend" && row.signedTx && row.signature) {
      const o = { sig: row.signature, bytes: row.signedTx.length, blockhash: row.blockhash ?? "" };
      const lastValidBlockHeight = Number(row.lastValidBlockHeight);
      const r = await broadcast(conn, row.signedTx, { ...o, lastValidBlockHeight, paceMs: SEND_PACE_MS });
      if (!r && (await advance(db(), row.id, "signed", "sent"))) state = "sent";
    }
    console.log(`resume launch ${row.id}: ${state}`);
    settleInBackground(conn, { ...row, state });
  }
}
