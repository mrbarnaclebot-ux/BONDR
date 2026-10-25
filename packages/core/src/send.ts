// The one send path (port of agencybook chain/send.ts without intents, caps, alerts or Helius Sender, which
// is deferred). Every compiled message passes the program allowlist before anything is signed.
import { setTimeout as delay } from "node:timers/promises";
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  type ConfirmedTransactionMeta,
  type Connection,
  type Keypair,
  PublicKey,
  SendTransactionError,
  type TransactionInstruction,
  TransactionMessage,
  type VersionedMessage,
  VersionedTransaction,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import { redact } from "./net.ts";
import { customCode, fromLogs } from "./trade-error.ts";

export const PACKET_LIMIT = 1232;

// Top-level programs only. Classic SPL Token is here because Q legs wrap WSOL; the lookup table program
// because the launch prepares a per-coin table (D-14).
export const ALLOWED_PROGRAMS: ReadonlySet<string> = new Set([
  "ComputeBudget111111111111111111111111111111",
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  "AddressLookupTab1e1111111111111111111111111",
]);

// "landed": on chain and met the expectation (for expectFail: failed with a program code). "failed": never
// sent, or on chain without meeting it. "unknown": sent, but neither confirmation nor a final history lookup
// saw it, so it may still land. A caller must never resend an "unknown" tx without re-checking its signature
// first (getSignatureStatuses with searchTransactionHistory, after lastValidBlockHeight has passed), or the
// same action can land twice.
export type SendStatus = "landed" | "failed" | "unknown";

export type SendResult = {
  ok: boolean; // always status === "landed"
  status: SendStatus;
  sig?: string;
  lastValidBlockHeight?: number; // an "unknown" sig is only safe to retry once the chain is past this height
  bytes: number;
  cu?: number;
  err?: string;
  code?: number;
  // A preflight rejection's message and simulation logs, unsliced and unredacted, for the error map only.
  // Worker-side: never sent to web or logged (S-WR-02).
  preflight?: readonly string[];
};

// 1000 micro-lamports is enough on devnet and the fork. A contended mainnet completion (the forced bond
// racing other buyers) needs a higher price; Phase 2 makes it a setting.
export const budget = (cuLimit: number, microLamports = 1000): TransactionInstruction[] => [
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }),
];

// v0 invoked programs are always static keys, so this sees every top-level program.
export function checkMessage(msg: VersionedMessage): string | null {
  if (msg.version !== 0) return "not v0";
  for (const ix of msg.compiledInstructions) {
    const p = msg.staticAccountKeys[ix.programIdIndex]?.toBase58() ?? "missing";
    if (!ALLOWED_PROGRAMS.has(p)) return `program not allowed: ${p}`;
  }
  return null;
}

const compile = (
  payer: PublicKey,
  ixs: TransactionInstruction[],
  tables: AddressLookupTableAccount[],
  bh: string,
) =>
  new TransactionMessage({ payerKey: payer, recentBlockhash: bh, instructions: ixs }).compileToV0Message(
    tables,
  );

const shortLen = (n: number): number => (n < 0x80 ? 1 : n < 0x4000 ? 2 : 3);

// Counted, not serialized: web3.js throws on a message over the packet limit, and an oversized launch is
// exactly what has to be measured (probe/measure.cjs method).
export function messageSize(msg: VersionedMessage): number {
  const m = msg as VersionedMessage & {
    addressTableLookups: { writableIndexes: number[]; readonlyIndexes: number[] }[];
  };
  let n = 1 + 3 + shortLen(m.staticAccountKeys.length) + 32 * m.staticAccountKeys.length + 32;
  n += shortLen(m.compiledInstructions.length);
  for (const ci of m.compiledInstructions) {
    const k = ci.accountKeyIndexes.length;
    n += 1 + shortLen(k) + k + shortLen(ci.data.length) + ci.data.length;
  }
  n += shortLen(m.addressTableLookups.length);
  for (const l of m.addressTableLookups) {
    const w = l.writableIndexes.length;
    const r = l.readonlyIndexes.length;
    n += 32 + shortLen(w) + w + shortLen(r) + r;
  }
  const sigs = m.header.numRequiredSignatures;
  return n + shortLen(sigs) + 64 * sigs;
}

export const wireSize = (
  payer: PublicKey,
  ixs: TransactionInstruction[],
  tables: AddressLookupTableAccount[] = [],
) => messageSize(compile(payer, ixs, tables, PublicKey.default.toBase58()));

// Helius free tier allows about one send per second (Pitfall 8), so sends are spaced process-wide. The slot
// is reserved before the await, so concurrent callers queue instead of all reading the same lastSend.
// ponytail: one process-wide limiter; per-RPC token bucket if multiple endpoints.
let lastSend = 0;
export async function pace(ms: number): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, lastSend + ms);
  lastSend = at;
  if (at > now) await delay(at - now);
}

export function statusOf(o: {
  sent: boolean;
  meta?: { err: unknown };
  code?: number;
  expectFail: boolean;
}): SendStatus {
  if (!o.sent) return "failed";
  if (!o.meta) return "unknown";
  const met = o.expectFail ? o.meta.err !== null && o.code !== undefined : o.meta.err === null;
  return met ? "landed" : "failed";
}

const result = (status: SendStatus, r: Omit<SendResult, "ok" | "status">): SendResult => ({
  ok: status === "landed",
  status,
  ...r,
});

// getTransaction can return null for a moment after confirmation on a load-balanced RPC.
export async function fetchTx(
  conn: Connection,
  sig: string,
): Promise<(VersionedTransactionResponse & { meta: ConfirmedTransactionMeta }) | undefined> {
  for (let i = 0; i < 20; i++) {
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (tx?.meta) return { ...tx, meta: tx.meta };
    await delay(500);
  }
  return undefined;
}

export const fetchMeta = async (
  conn: Connection,
  sig: string,
): Promise<ConfirmedTransactionMeta | undefined> => (await fetchTx(conn, sig))?.meta;

// Polls instead of confirmTransaction: its websocket subscription keeps the Node process alive after the
// run, and the free tier rations websockets anyway.
export async function confirm(conn: Connection, sig: string, lastValidBlockHeight: number): Promise<void> {
  for (;;) {
    const st = (await conn.getSignatureStatuses([sig])).value[0];
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error(`expired: ${sig}`);
    await delay(800);
  }
}

// One last look with history after confirm gave up: the tx can land after its poll expired, and the poll
// itself can fail on a flaky RPC. Returns the confirm error text only when the tx is still unseen.
async function unseen(conn: Connection, sig: string, lastValidBlockHeight: number): Promise<string | null> {
  try {
    await confirm(conn, sig, lastValidBlockHeight);
    return null;
  } catch (e) {
    const st = await conn.getSignatureStatuses([sig], { searchTransactionHistory: true }).then(
      (r) => r.value[0],
      () => null,
    );
    const seen = st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized";
    return seen ? null : redact(e instanceof Error ? e.message : String(e));
  }
}

export async function settle(
  conn: Connection,
  sig: string,
  bytes: number,
  expectFail: boolean,
  bh: BlockhashInfo,
) {
  const lost = await unseen(conn, sig, bh.lastValidBlockHeight);
  if (lost) return result("unknown", { sig, bytes, err: `landed status unknown: ${lost}` });
  const meta = await fetchMeta(conn, sig);
  if (!meta) return result("unknown", { sig, bytes, err: "landed status unknown: no transaction meta" });
  const logs = fromLogs(meta.logMessages);
  const code = customCode(meta.err) ?? (meta.err ? logs.code : undefined);
  const err = meta.err ? redact(`${logs.name ?? "failed"} ${JSON.stringify(meta.err)}`) : undefined;
  const status = statusOf({ sent: true, meta, code, expectFail });
  return result(status, { sig, bytes, cu: meta.computeUnitsConsumed, err, code });
}

// Only a preflight rejection carries simulation logs, and preflight runs before the RPC forwards the tx, so
// that alone proves nothing went out. A timeout or network error can hit after the tx reached a leader.
export const preflightRejected = (e: unknown): boolean =>
  e instanceof SendTransactionError && Array.isArray(e.transactionError.logs);

function thrown(e: unknown, bytes: number, sig: string, lastValidBlockHeight: number): SendResult {
  const te = e instanceof SendTransactionError ? e.transactionError : undefined;
  const logs = fromLogs(te?.logs);
  const name = e instanceof Error ? e.name : "Error";
  const text = e instanceof Error ? e.message : String(e);
  const err = redact(`${logs.name ?? name}: ${text}`).slice(0, 400);
  const status = statusOf({ sent: !preflightRejected(e), expectFail: false });
  const seen = status === "unknown" ? { sig, lastValidBlockHeight } : {};
  const preflight = te?.logs && { preflight: [te.message, ...te.logs] };
  return result(status, { ...seen, ...preflight, bytes, err, code: logs.code });
}

export type BlockhashInfo = { blockhash: string; lastValidBlockHeight: number };
export type RawOpts = {
  sig: string; // slot 0 of the wire: the tx id, known before sending
  bytes: number;
  blockhash: string;
  lastValidBlockHeight: number;
  paceMs?: number;
  expectFail?: boolean; // skips preflight, so the expected failure lands with a signature and meta.err
};

// Paced send of a signed wire. null: the RPC accepted it. Otherwise the throw as a result: "failed" when
// preflight rejected it (nothing went out), "unknown" when it may have gone out.
export async function broadcast(conn: Connection, raw: Uint8Array, o: RawOpts): Promise<SendResult | null> {
  await pace(o.paceMs ?? 0);
  try {
    await conn.sendRawTransaction(raw, { skipPreflight: o.expectFail === true, maxRetries: 3 });
    return null;
  } catch (e) {
    return thrown(e, o.bytes, o.sig, o.lastValidBlockHeight);
  }
}

export async function sendRaw(conn: Connection, raw: Uint8Array, o: RawOpts): Promise<SendResult> {
  const sent = await broadcast(conn, raw, o);
  if (sent) return sent;
  return {
    ...(await settle(conn, o.sig, o.bytes, o.expectFail === true, o)),
    lastValidBlockHeight: o.lastValidBlockHeight,
  };
}

export type SendOpts = {
  conn: Connection;
  payer: Keypair;
  signers?: Keypair[];
  ixs: TransactionInstruction[];
  tables?: AddressLookupTableAccount[];
  expectFail?: boolean;
  paceMs?: number;
};

type Signed =
  | { ok: true; raw: Uint8Array; sig: string; bytes: number }
  | { ok: false; err: string; bytes: number };

// Compile, allowlist, size and sign without sending, so the engine can record its intent (the signature and
// lastValidBlockHeight) before broadcast (D-08). Every engine tx is signed here, behind checkMessage.
export function signTx(o: SendOpts & { bh: BlockhashInfo }): Signed {
  const msg = compile(o.payer.publicKey, o.ixs, o.tables ?? [], o.bh.blockhash);
  const bytes = messageSize(msg);
  const refused = checkMessage(msg);
  if (refused) return { ok: false, bytes, err: `refused to sign: ${refused}` };
  if (bytes > PACKET_LIMIT) return { ok: false, bytes, err: `too large: ${bytes} > ${PACKET_LIMIT} bytes` };
  const tx = new VersionedTransaction(msg);
  tx.sign([o.payer, ...(o.signers ?? [])]);
  return { ok: true, raw: tx.serialize(), sig: bs58.encode(tx.signatures[0]), bytes };
}

export async function sendTx(o: SendOpts): Promise<SendResult> {
  const bh: BlockhashInfo = await o.conn.getLatestBlockhash();
  const s = signTx({ ...o, bh });
  if (!s.ok) return result("failed", { bytes: s.bytes, err: s.err });
  return sendRaw(o.conn, s.raw, {
    ...bh,
    sig: s.sig,
    bytes: s.bytes,
    paceMs: o.paceMs,
    expectFail: o.expectFail,
  });
}
