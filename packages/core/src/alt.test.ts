import { type Connection, Keypair, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { expect, test } from "vitest";
import { createTable, freshSlot, sharedKeys, tableKeys } from "./alt.ts";

const key = () => Keypair.generate().publicKey;
const signer = key();
const prog = key();
const [a, b, c] = [key(), key(), key()];
const ix = (programId = prog, ...keys: { pubkey: ReturnType<typeof key>; isSigner: boolean }[]) =>
  new TransactionInstruction({
    programId,
    keys: keys.map((k) => ({ ...k, isWritable: true })),
    data: Buffer.alloc(0),
  });

test("tableKeys excludes every signer and every invoked program id", () => {
  // The signer appears as a non-signer in the second ix and prog appears as a plain account: both stay out.
  const ixs = [
    ix(prog, { pubkey: signer, isSigner: true }, { pubkey: a, isSigner: false }),
    ix(
      SystemProgram.programId,
      { pubkey: signer, isSigner: false },
      { pubkey: prog, isSigner: false },
      { pubkey: b, isSigner: false },
    ),
    ix(prog, { pubkey: a, isSigner: false }),
  ];
  expect(tableKeys(ixs).map(String)).toEqual([a, b].map(String));
});

test("sharedKeys returns only keys present in both lists", () => {
  const one = [ix(prog, { pubkey: a, isSigner: false }, { pubkey: b, isSigner: false })];
  const two = [ix(prog, { pubkey: b, isSigner: false }, { pubkey: c, isSigner: false })];
  expect(sharedKeys(one, two).map(String)).toEqual([String(b)]);
});

test("freshSlot never hands one authority the same finalized slot twice, nor one at the tip", async () => {
  // [finalized, confirmed] per poll: 10 below tip, 10 again, 11 at the tip, 11 below tip.
  const polls = [10, 12, 10, 12, 11, 11, 11, 13];
  const conn = { getSlot: async () => polls.shift() } as unknown as Connection;
  expect(await freshSlot(conn, signer)).toBe(10);
  expect(await freshSlot(conn, signer)).toBe(11);
  expect(polls).toEqual([]);
});

test("createTable refuses an empty key list", async () => {
  await expect(createTable({} as Connection, Keypair.generate(), [])).rejects.toThrow("at least one key");
});

test("createTable returns the table address when an RPC call throws after the address exists (WR-02)", async () => {
  const conn = {
    getSlot: async (c: string) => (c === "finalized" ? 7 : 8),
    getLatestBlockhash: async () => {
      throw new Error("429 Too Many Requests");
    },
  } as unknown as Connection;
  const r = await createTable(conn, Keypair.generate(), [a]);
  expect(r).toMatchObject({ ok: false, err: "429 Too Many Requests" });
  expect(r.address).toBeDefined();
});
