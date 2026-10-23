// Pump and PumpSwap events read from the anchor emit_cpi inner instruction (port of agencybook
// chain/events.ts). Only a program can sign as its event authority, so account 0 of the self-CPI proves the
// event is real. Never parse "Program data" logs: Surfpool and RPCs truncate them.
import bs58 from "bs58";
import {
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_EVENT_AUTHORITY_PDA,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
  pumpAmmJson,
  pumpIdl,
} from "./pump.ts";

// Both the raw RPC JSON (fixtures) and web3.js VersionedTransactionResponse fit: keys may be strings or
// PublicKeys, and String() gives base58 for both.
type Key = string | { toBase58(): string };
export type EventTx = {
  transaction: { message: { accountKeys?: readonly Key[]; staticAccountKeys?: readonly Key[] } };
  meta: {
    err?: unknown;
    innerInstructions?:
      | { index: number; instructions: { programIdIndex: number; accounts: number[]; data: string }[] }[]
      | null;
    loadedAddresses?: { writable: readonly Key[]; readonly: readonly Key[] } | null;
  } | null;
};

const TAG = "e445a52e51cb9a1d"; // anchor EVENT_IX_TAG
export type EventProgram = "pump" | "amm";
const PROGRAMS = [
  { name: "pump", program: PUMP_PROGRAM_ID, authority: PUMP_EVENT_AUTHORITY_PDA, idl: pumpIdl },
  { name: "amm", program: PUMP_AMM_PROGRAM_ID, authority: PUMP_AMM_EVENT_AUTHORITY_PDA, idl: pumpAmmJson },
].map((p) => ({ ...p, program: p.program.toBase58(), authority: p.authority.toBase58() }));
// Keyed by program and discriminator, so one program's event can never decode as the other's.
const NAMES: Record<string, string> = Object.fromEntries(
  PROGRAMS.flatMap((p) =>
    p.idl.events.map((e) => [`${p.name}:${Buffer.from(e.discriminator).toString("hex")}`, e.name]),
  ),
);
// The SDK decoders are the IDL's anchor coder plus padding for older event layouts. Only the events BONDR
// reads have one; others keep their name with empty data. ponytail: add a decoder when a phase needs one.
const DECODE: Record<string, (b: Buffer) => object> = {
  CreateEvent: (b) => PUMP_SDK.decodeCreateEventBc(b),
  TradeEvent: (b) => PUMP_SDK.decodeTradeEventBc(b),
  CompleteEvent: (b) => PUMP_SDK.decodeCompleteEventBc(b),
  PostCompleteBuyEvent: (b) => PUMP_SDK.decodePostCompleteBuyEvent(b),
  BuyEvent: (b) => PUMP_SDK.decodeBuyEventAmm(b),
  SellEvent: (b) => PUMP_SDK.decodeSellEventAmm(b),
  CreatePoolEvent: (b) => PUMP_SDK.decodeCreatePoolEventAmm(b),
};
export type PumpEvent = { name: string; program: EventProgram; ix: number; data: Record<string, unknown> };

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

// Decode one event body; a layout the pinned SDK cannot read is reported as invalid, never thrown.
function decode(name: string, body: Buffer): { name: string; data: Record<string, unknown> } {
  const fn = DECODE[name];
  if (!fn) return { name, data: {} };
  try {
    return { name, data: normalize(fn(body)) };
  } catch {
    return { name: `invalid:${name}`, data: {} };
  }
}

// A failed tx rolled back everything it did, but its meta can still list the inner instructions it ran
// before failing, so those events never happened. ix is the running index of accepted events in the tx.
export function innerEvents(tx: EventTx): PumpEvent[] {
  if (tx.meta?.err) return [];
  const keys = keysOf(tx);
  const out: PumpEvent[] = [];
  for (const g of tx.meta?.innerInstructions ?? [])
    for (const ix of g.instructions) {
      const p = PROGRAMS.find((x) => x.program === keys[ix.programIdIndex]);
      if (!p || keys[ix.accounts[0] ?? -1] !== p.authority) continue;
      const d = Buffer.from(bs58.decode(ix.data));
      if (d.length < 16 || d.subarray(0, 8).toString("hex") !== TAG) continue;
      const disc = d.subarray(8, 16).toString("hex");
      const name = NAMES[`${p.name}:${disc}`] ?? `unknown:${disc}`;
      out.push({
        ...decode(name, Buffer.from(d.subarray(16))),
        program: p.name as EventProgram,
        ix: out.length,
      });
    }
  return out;
}

export function completeEvents(tx: EventTx): { mint: string; bondingCurve: string }[] {
  return innerEvents(tx)
    .filter((e) => e.name === "CompleteEvent")
    .map((e) => ({ mint: String(e.data.mint), bondingCurve: String(e.data.bondingCurve) }));
}
