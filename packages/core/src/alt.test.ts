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

test("freshSlot takes the newest block below finalized and never the same one twice", async () => {
  const tips = [12, 12, 14];
  const conn = {
    getSlot: async () => tips.shift(),
    getBlocks: async (_start: number, end: number) => [end - 2, end].filter((b) => b !== 11), // 11 skipped
  } as unknown as Connection;
  expect(await freshSlot(conn, signer)).toBe(9); // tip 12: blocks up to 11, 11 skipped
  expect(await freshSlot(conn, signer)).toBe(13); // tip 12 again gives 9, already used; tip 14 gives 13
  expect(tips).toEqual([]);
});

test("createTable refuses an empty key list", async () => {
  await expect(createTable({} as Connection, Keypair.generate(), [])).rejects.toThrow("at least one key");
});

test("createTable returns the table address when an RPC call throws after the address exists (WR-02)", async () => {
  const conn = {
    getSlot: async () => 8,
    getBlocks: async () => [7],
    getLatestBlockhash: async () => {
      throw new Error("429 Too Many Requests");
    },
  } as unknown as Connection;
  const r = await createTable(conn, Keypair.generate(), [a]);
  expect(r).toMatchObject({ ok: false, err: "429 Too Many Requests" });
  expect(r.address).toBeDefined();
});
