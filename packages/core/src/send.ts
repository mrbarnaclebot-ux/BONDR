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
} from "@solana/web3.js";
import bs58 from "bs58";
import { redact } from "./net.ts";

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
};

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

// Anchor logs carry the readable name and the program logs carry the hex code; both make the row evidence.
function fromLogs(logs: readonly string[] | null | undefined): { code?: number; name?: string } {
  const text = (logs ?? []).join("\n");
  const hex = text.match(/custom program error: (0x[0-9a-f]+)/i)?.[1];
  const num = text.match(/Error Number: (\d+)/)?.[1];
  const code = hex ? Number.parseInt(hex, 16) : num ? Number(num) : undefined;
  return { code, name: text.match(/Error Code: (\w+)/)?.[1] };
}

function customCode(err: unknown): number | undefined {
  const ie = (err as { InstructionError?: [number, unknown] } | null)?.InstructionError;
  const custom = (ie?.[1] as { Custom?: number } | undefined)?.Custom;
  return typeof custom === "number" ? custom : undefined;
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
export async function fetchMeta(
  conn: Connection,
  sig: string,
): Promise<ConfirmedTransactionMeta | undefined> {
  for (let i = 0; i < 20; i++) {
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (tx?.meta) return tx.meta;
    await delay(500);
  }
  return undefined;
}

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

async function settle(conn: Connection, sig: string, bytes: number, expectFail: boolean, bh: BlockhashInfo) {
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
  const logs = fromLogs(e instanceof SendTransactionError ? e.transactionError.logs : undefined);
  const name = e instanceof Error ? e.name : "Error";
  const text = e instanceof Error ? e.message : String(e);
  const err = redact(`${logs.name ?? name}: ${text}`).slice(0, 400);
  const status = statusOf({ sent: !preflightRejected(e), expectFail: false });
  const seen = status === "unknown" ? { sig, lastValidBlockHeight } : {};
  return result(status, { ...seen, bytes, err, code: logs.code });
}

type BlockhashInfo = { blockhash: string; lastValidBlockHeight: number };
export type SendOpts = {
  conn: Connection;
  payer: Keypair;
  signers?: Keypair[];
  ixs: TransactionInstruction[];
  tables?: AddressLookupTableAccount[];
  expectFail?: boolean; // skips preflight, so the expected failure lands with a signature and meta.err
  paceMs?: number;
};

export async function sendTx(o: SendOpts): Promise<SendResult> {
  const bh: BlockhashInfo = await o.conn.getLatestBlockhash();
  const msg = compile(o.payer.publicKey, o.ixs, o.tables ?? [], bh.blockhash);
  const bytes = messageSize(msg);
  const refused = checkMessage(msg);
  if (refused) return result("failed", { bytes, err: `refused to sign: ${refused}` });
  if (bytes > PACKET_LIMIT)
    return result("failed", { bytes, err: `too large: ${bytes} > ${PACKET_LIMIT} bytes` });
  const tx = new VersionedTransaction(msg);
  tx.sign([o.payer, ...(o.signers ?? [])]);
  await pace(o.paceMs ?? 0);
  const expectFail = o.expectFail === true;
  const raw = tx.serialize();
  // The signature is the tx id, known before sending, so a throw mid-send still leaves a sig to look up.
  const sig = bs58.encode(tx.signatures[0]);
  try {
    await o.conn.sendRawTransaction(raw, { skipPreflight: expectFail, maxRetries: 3 });
    return {
      ...(await settle(o.conn, sig, bytes, expectFail, bh)),
      lastValidBlockHeight: bh.lastValidBlockHeight,
    };
  } catch (e) {
    return thrown(e, bytes, sig, bh.lastValidBlockHeight);
  }
}
