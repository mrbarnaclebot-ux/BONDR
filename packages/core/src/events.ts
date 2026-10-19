// Pump events read from the anchor emit_cpi inner instruction (port of agencybook chain/events.ts). Only the
// program can sign as its event authority, so account 0 of the self-CPI proves the event is real. Never parse
// "Program data" logs: Surfpool and RPCs truncate them.
import bs58 from "bs58";
import { PUMP_EVENT_AUTHORITY_PDA, PUMP_PROGRAM_ID, PUMP_SDK, pumpIdl } from "./pump.ts";

// Both the raw RPC JSON (fixtures) and web3.js VersionedTransactionResponse fit: keys may be strings or
// PublicKeys, and String() gives base58 for both.
type Key = string | { toBase58(): string };
export type EventTx = {
  transaction: { message: { accountKeys?: readonly Key[]; staticAccountKeys?: readonly Key[] } };
  meta: {
    innerInstructions?:
      | { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[]
      | null;
    loadedAddresses?: { writable: readonly Key[]; readonly: readonly Key[] } | null;
  } | null;
};

const TAG = "e445a52e51cb9a1d"; // anchor EVENT_IX_TAG
const NAMES: Record<string, string> = Object.fromEntries(
  pumpIdl.events.map((e) => [Buffer.from(e.discriminator).toString("hex"), e.name]),
);
// The SDK decoders are the IDL's anchor coder plus padding for older event layouts. Only the events BONDR
// reads have one; others keep their name with empty data. ponytail: add a decoder when a phase needs one.
const DECODE: Record<string, (b: Buffer) => object> = {
  CreateEvent: (b) => PUMP_SDK.decodeCreateEventBc(b),
  TradeEvent: (b) => PUMP_SDK.decodeTradeEventBc(b),
  CompleteEvent: (b) => PUMP_SDK.decodeCompleteEventBc(b),
};

// BN and PublicKey to strings, so facts and JSON stay exact.
function normalize(o: object): Record<string, unknown> {
  const str = (v: unknown) => (v && typeof v === "object" && "toString" in v ? String(v) : v);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, str(v)]));
}

const keysOf = (tx: EventTx): string[] =>
  [
    ...(tx.transaction.message.staticAccountKeys ?? tx.transaction.message.accountKeys ?? []),
    ...(tx.meta?.loadedAddresses?.writable ?? []),
    ...(tx.meta?.loadedAddresses?.readonly ?? []),
  ].map(String);

export function innerEvents(tx: EventTx): { name: string; data: Record<string, unknown> }[] {
  const keys = keysOf(tx);
  const [program, authority] = [PUMP_PROGRAM_ID.toBase58(), PUMP_EVENT_AUTHORITY_PDA.toBase58()];
  const out: { name: string; data: Record<string, unknown> }[] = [];
  for (const g of tx.meta?.innerInstructions ?? [])
    for (const ix of g.instructions) {
      if (keys[ix.programIdIndex] !== program || keys[ix.accounts[0] ?? -1] !== authority) continue;
      const d = Buffer.from(bs58.decode(ix.data));
      if (d.length < 16 || d.subarray(0, 8).toString("hex") !== TAG) continue;
      const disc = d.subarray(8, 16).toString("hex");
      const name = NAMES[disc] ?? `unknown:${disc}`;
      const decode = DECODE[name];
      out.push({ name, data: decode ? normalize(decode(Buffer.from(d.subarray(16)))) : {} });
    }
  return out;
}

export function completeEvents(tx: EventTx): { mint: string; bondingCurve: string }[] {
  return innerEvents(tx)
    .filter((e) => e.name === "CompleteEvent")
    .map((e) => ({ mint: String(e.data.mint), bondingCurve: String(e.data.bondingCurve) }));
}
