// The one send path (port of agencybook chain/send.ts without intents, caps, alerts or Helius Sender, which
// is deferred). Every compiled message passes the program allowlist before anything is signed.
import { setTimeout as delay } from "node:timers/promises";
import {
  type AddressLookupTableAccount,
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  PublicKey,
  type TransactionInstruction,
  TransactionMessage,
  type VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
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

export type SendResult = {
  ok: boolean;
  sig?: string;
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

// Helius free tier allows about one send per second (Pitfall 8), so sends are spaced process-wide.
let lastSend = 0;
async function pace(ms: number): Promise<void> {
  const wait = lastSend + ms - Date.now();
  if (wait > 0) await delay(wait);
  lastSend = Date.now();
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

type TxMeta = { err: unknown; computeUnitsConsumed?: number; logMessages?: string[] | null };

// getTransaction can return null for a moment after confirmation on a load-balanced RPC.
async function fetchMeta(conn: Connection, sig: string): Promise<TxMeta | undefined> {
  for (let i = 0; i < 20; i++) {
    const tx = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (tx?.meta) return tx.meta as TxMeta;
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

async function settle(conn: Connection, sig: string, bytes: number, expectFail: boolean, bh: BlockhashInfo) {
  await confirm(conn, sig, bh.lastValidBlockHeight);
  const meta = await fetchMeta(conn, sig);
  if (!meta) return { ok: false, sig, bytes, err: "landed status unknown: no transaction meta" };
  const logs = fromLogs(meta.logMessages);
  const code = customCode(meta.err) ?? (meta.err ? logs.code : undefined);
  const err = meta.err ? redact(`${logs.name ?? "failed"} ${JSON.stringify(meta.err)}`) : undefined;
  const ok = expectFail ? meta.err !== null && code !== undefined : meta.err === null;
  return { ok, sig, bytes, cu: meta.computeUnitsConsumed, err, code };
}

function thrown(e: unknown, bytes: number, expectFail: boolean, sig?: string): SendResult {
  const logs = fromLogs((e as { logs?: string[]; transactionLogs?: string[] }).logs);
  const name = e instanceof Error ? e.name : "Error";
  const text = e instanceof Error ? e.message : String(e);
  const err = redact(`${logs.name ?? name}: ${text}`).slice(0, 400);
  return { ok: expectFail && logs.code !== undefined, sig, bytes, err, code: logs.code };
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
  if (refused) return { ok: false, bytes, err: `refused to sign: ${refused}` };
  if (bytes > PACKET_LIMIT) return { ok: false, bytes, err: `too large: ${bytes} > ${PACKET_LIMIT} bytes` };
  const tx = new VersionedTransaction(msg);
  tx.sign([o.payer, ...(o.signers ?? [])]);
  await pace(o.paceMs ?? 0);
  const expectFail = o.expectFail === true;
  let sig: string | undefined;
  try {
    sig = await o.conn.sendRawTransaction(tx.serialize(), { skipPreflight: expectFail, maxRetries: 3 });
    return await settle(o.conn, sig, bytes, expectFail, bh);
  } catch (e) {
    return thrown(e, bytes, expectFail, sig); // sig is set when the send went out but confirmation threw
  }
}
