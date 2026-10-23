// Sign order A co-sign (D-12, RESEARCH Pattern 3, port of agencybook sign.ts and completeLaunch). The mint
// signature is the only thing that makes a launch valid, so it is added only to the exact message the worker
// built and stored, signed by the dev, with the stored exit inside. Worker-only: it loads pump.ts.
import { createHash } from "node:crypto";
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import {
  type AddressLookupTableAccount,
  type Keypair,
  PublicKey,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { PUMP_AMM_PROGRAM_ID } from "./pump.ts";
import { signatureOk } from "./sig.ts";

const SIG = 64;
const BURN_CHECKED = 15; // Token-2022 instruction tag
// The SDK's sell exit is the AMM program's multi_hop_swap; its IDL is not exported, so the anchor
// discriminator is derived the way anchor does: sha256("global:<name>")[0..8].
const MULTI_HOP_SWAP = createHash("sha256").update("global:multi_hop_swap").digest().subarray(0, 8);

export type CosignRefusal = "message_mismatch" | "bad_signature" | "exit_missing";
type Addr = PublicKey | string;

// Raw slice compare, never a re-serialization (RESEARCH Anti-patterns). The shortvec signature count is one
// byte for up to 127 signers; launches use 2.
export function sameMessage(stored: Uint8Array, wire: Uint8Array, signers: number): boolean {
  if (wire[0] !== signers || wire.length !== 1 + SIG * signers + stored.length) return false;
  return Buffer.from(wire.subarray(1 + SIG * signers)).equals(stored);
}

export const slot = (wire: Uint8Array, index: number): Uint8Array =>
  wire.subarray(1 + SIG * index, 1 + SIG * (index + 1));

export { signatureOk };

// Burn: a Token-2022 BurnChecked of the dev's child ATA, the mint, the dev as owner. Sell: multi_hop_swap
// with the dev and the mint among its accounts.
export function exitPresent(
  message: VersionedMessage,
  tables: AddressLookupTableAccount[],
  o: { exit: "burn" | "sell"; mint: Addr; dev: Addr },
): boolean {
  const keys = message.getAccountKeys({ addressLookupTableAccounts: tables });
  const [mint, dev] = [String(o.mint), String(o.dev)];
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(dev), true, T22).toBase58();
  return message.compiledInstructions.some((ix) => {
    const program = keys.get(ix.programIdIndex)?.toBase58();
    const accounts = ix.accountKeyIndexes.map((i) => keys.get(i)?.toBase58());
    if (o.exit === "burn")
      return (
        program === T22.toBase58() &&
        ix.data[0] === BURN_CHECKED &&
        accounts.join() === [ata, mint, dev].join()
      );
    const tag = Buffer.from(ix.data.subarray(0, 8));
    return (
      program === PUMP_AMM_PROGRAM_ID.toBase58() &&
      tag.equals(MULTI_HOP_SWAP) &&
      accounts.includes(dev) &&
      accounts.includes(mint)
    );
  });
}

export type CosignInput = {
  wire: Uint8Array; // the dev-signed wire from the browser: untrusted
  stored: Uint8Array; // the message bytes prepare stored
  dev: Addr;
  mint: Keypair;
  tables: AddressLookupTableAccount[];
  exit: "burn" | "sell"; // from the stored row, never from the request
};

export type CosignResult = { ok: true; wire: Uint8Array } | { ok: false; reason: CosignRefusal };

export function cosign(i: CosignInput): CosignResult {
  if (!sameMessage(i.stored, i.wire, 2)) return { ok: false, reason: "message_mismatch" };
  if (!signatureOk(i.stored, slot(i.wire, 0), i.dev)) return { ok: false, reason: "bad_signature" };
  const msg = VersionedMessage.deserialize(i.stored);
  if (!exitPresent(msg, i.tables, { exit: i.exit, mint: i.mint.publicKey, dev: i.dev }))
    return { ok: false, reason: "exit_missing" };
  const tx = VersionedTransaction.deserialize(i.wire);
  tx.sign([i.mint]);
  const wire = tx.serialize();
  // tx.sign signs web3.js's re-serialization; checking slot 1 against the stored bytes proves they match.
  if (!signatureOk(i.stored, slot(wire, 1), i.mint.publicKey) || !sameMessage(i.stored, wire, 2))
    return { ok: false, reason: "message_mismatch" };
  return { ok: true, wire };
}

export const signatureOf = (wire: Uint8Array): string => bs58.encode(slot(wire, 0));
