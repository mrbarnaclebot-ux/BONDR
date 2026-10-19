// Per-coin address lookup table for the launch tx (D-14). Signers and invoked programs must stay static in a
// v0 message, so only the remaining keys go into the table.
import { setTimeout as delay } from "node:timers/promises";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  type Connection,
  Keypair,
  type PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import { sendTx } from "./send.ts";

// One create + extend tx holds about 29 keys under the 1232-byte limit; 25 leaves room for the header.
const CHUNK = 25;

export function tableKeys(ixs: TransactionInstruction[]): PublicKey[] {
  const skip = new Set(ixs.map((i) => i.programId.toBase58()));
  for (const ix of ixs) for (const k of ix.keys) if (k.isSigner) skip.add(k.pubkey.toBase58());
  const out = new Map<string, PublicKey>();
  for (const ix of ixs)
    for (const k of ix.keys) if (!skip.has(k.pubkey.toBase58())) out.set(k.pubkey.toBase58(), k.pubkey);
  return [...out.values()];
}

export function sharedKeys(a: TransactionInstruction[], b: TransactionInstruction[]): PublicKey[] {
  const inB = new Set(tableKeys(b).map((k) => k.toBase58()));
  return tableKeys(a).filter((k) => inB.has(k.toBase58()));
}

// For offline size measurement only; never sent.
export const memoryTable = (addresses: PublicKey[]): AddressLookupTableAccount =>
  new AddressLookupTableAccount({
    key: Keypair.generate().publicKey,
    state: {
      deactivationSlot: 2n ** 64n - 1n,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      addresses,
    },
  });

// A table is usable only from the slot after its last extension (warm-up), so poll until then.
async function warm(conn: Connection, key: PublicKey, n: number): Promise<AddressLookupTableAccount> {
  for (let i = 0; i < 60; i++) {
    const t = (await conn.getAddressLookupTable(key)).value;
    if (t && t.state.addresses.length === n && (await conn.getSlot("confirmed")) > t.state.lastExtendedSlot)
      return t;
    await delay(500);
  }
  throw new Error(`lookup table ${key.toBase58()} did not warm up`);
}

export type TableResult = {
  table?: AddressLookupTableAccount;
  ok: boolean;
  sig?: string;
  bytes: number;
  cu?: number;
  err?: string;
  txs: number;
};

// The first tx creates and extends; more than CHUNK keys need follow-up extend txs. The row reports the first
// signature, the largest tx and the total CU.
export async function createTable(
  conn: Connection,
  payer: Keypair,
  keys: PublicKey[],
  paceMs = 0,
): Promise<TableResult> {
  const authority = payer.publicKey;
  const recentSlot = await conn.getSlot("finalized");
  const [create, lookupTable] = AddressLookupTableProgram.createLookupTable({
    authority,
    payer: authority,
    recentSlot,
  });
  const out: TableResult = { ok: true, bytes: 0, cu: 0, txs: 0 };
  for (let i = 0; i < keys.length; i += CHUNK) {
    const extend = AddressLookupTableProgram.extendLookupTable({
      payer: authority,
      authority,
      lookupTable,
      addresses: keys.slice(i, i + CHUNK),
    });
    const r = await sendTx({ conn, payer, ixs: i === 0 ? [create, extend] : [extend], paceMs });
    Object.assign(out, {
      sig: out.sig ?? r.sig,
      bytes: Math.max(out.bytes, r.bytes),
      cu: (out.cu ?? 0) + (r.cu ?? 0),
    });
    out.txs++;
    if (!r.ok) return { ...out, ok: false, err: r.err };
  }
  return { ...out, table: await warm(conn, lookupTable, keys.length) };
}
