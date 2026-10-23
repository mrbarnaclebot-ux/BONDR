import { sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  Keypair,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { memoryTable } from "./alt.ts";
import { cosign, exitPresent, sameMessage, signatureOk, slot } from "./cosign.ts";

const dev = Keypair.generate();
const mint = Keypair.generate();
const other = Keypair.generate().publicKey;
const ata = getAssociatedTokenAddressSync(mint.publicKey, dev.publicKey, true, T22);
const table = memoryTable([other, ata, T22]);
const BH = PublicKey.default.toBase58();
const edSign = (kp: Keypair, msg: Uint8Array) => {
  const [d, x] = [kp.secretKey.subarray(0, 32), kp.publicKey.toBytes()].map((b) =>
    Buffer.from(b).toString("base64url"),
  );
  return new Uint8Array(sign(null, msg, { key: { kty: "OKP", crv: "Ed25519", d, x }, format: "jwk" }));
};

// Dev pays (slot 0); createAccount makes the mint the second signer (slot 1), as in a launch.
function launchLike(withBurn: boolean) {
  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: dev.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports: 1,
      space: 0,
      programId: T22,
    }),
    createAssociatedTokenAccountIdempotentInstruction(dev.publicKey, ata, dev.publicKey, mint.publicKey, T22),
    SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: other, lamports: 1 }),
    ...(withBurn ? [createBurnCheckedInstruction(ata, mint.publicKey, dev.publicKey, 5n, 6, [], T22)] : []),
  ];
  const msg = new TransactionMessage({ payerKey: dev.publicKey, recentBlockhash: BH, instructions: ixs });
  const v0 = msg.compileToV0Message([table]);
  const stored = v0.serialize();
  const tx = new VersionedTransaction(v0);
  tx.sign([dev]);
  return { v0, stored, wire: tx.serialize() };
}

const run = (stored: Uint8Array, wire: Uint8Array, exit: "burn" | "sell" = "burn") =>
  cosign({ wire, stored, dev: dev.publicKey, mint, tables: [table], exit });
const refusal = (r: ReturnType<typeof run>) => (r.ok ? "ok" : r.reason);

describe("cosign", () => {
  const { stored, wire } = launchLike(true);

  test("adds a mint signature that verifies, over the stored bytes", () => {
    const r = run(stored, wire);
    if (!r.ok) throw new Error(r.reason);
    expect(signatureOk(stored, slot(r.wire, 1), mint.publicKey)).toBe(true);
    expect(sameMessage(stored, r.wire, 2)).toBe(true);
    expect(Buffer.from(slot(r.wire, 0))).toEqual(Buffer.from(slot(wire, 0)));
  });

  test("one flipped message byte after signing is message_mismatch", () => {
    const bad = Uint8Array.from(wire);
    bad[bad.length - 5] ^= 1;
    expect(refusal(run(stored, bad))).toBe("message_mismatch");
  });

  test("slot 0 signed by another key is bad_signature", () => {
    const bad = Uint8Array.from(wire);
    bad.set(edSign(Keypair.generate(), stored), 1);
    expect(refusal(run(stored, bad))).toBe("bad_signature");
  });

  test("slot 0 all zeros is bad_signature", () => {
    const bad = Uint8Array.from(wire);
    bad.fill(0, 1, 65);
    expect(refusal(run(stored, bad))).toBe("bad_signature");
  });

  test("an extra signature slot is message_mismatch", () => {
    const bad = Uint8Array.from(wire);
    bad[0] = 3;
    expect(refusal(run(stored, bad))).toBe("message_mismatch");
  });

  test("a message without the burn, with exit burn stored, is exit_missing", () => {
    const noBurn = launchLike(false);
    expect(refusal(run(noBurn.stored, noBurn.wire))).toBe("exit_missing");
    expect(refusal(run(stored, wire, "sell"))).toBe("exit_missing");
  });
});

// The pool-venue launch.sell message 02-03 captured from the fork (Q migrated): its sell exit is the AMM's
// multi_hop_swap (child curve hop, then Q's pool hop).
test("exitPresent finds the multi_hop_swap sell in the pool-sell-launch fixture, and no burn", () => {
  const f = JSON.parse(readFileSync(new URL("./fixtures/pool-sell-launch.json", import.meta.url), "utf8"));
  const msg = VersionedMessage.deserialize(Buffer.from(f.message, "base64"));
  const state = { ...memoryTable([]).state, addresses: f.addresses.map((a: string) => new PublicKey(a)) };
  const tables = [new AddressLookupTableAccount({ key: new PublicKey(f.table), state })];
  const o = { mint: f.mint, dev: f.dev };
  expect(exitPresent(msg, tables, { exit: "sell", ...o })).toBe(true);
  expect(exitPresent(msg, tables, { exit: "burn", ...o })).toBe(false);
});
