import {
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  type Connection,
  Keypair,
  PublicKey,
  SendTransactionError,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { describe, expect, test } from "vitest";
import { checkMessage, PACKET_LIMIT, pace, preflightRejected, sendRaw, statusOf, wireSize } from "./send.ts";

const payer = Keypair.generate();
const to = Keypair.generate().publicKey;
const BH = PublicKey.default.toBase58();
const v0 = (ixs: TransactionInstruction[]) =>
  new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: BH,
    instructions: ixs,
  }).compileToV0Message();
const transfer = SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports: 1 });
const program = (id: string) =>
  new TransactionInstruction({ programId: new PublicKey(id), keys: [], data: Buffer.from([1]) });

describe("checkMessage", () => {
  test("passes every allowed program", () => {
    const ids = [
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
      "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
      "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
      "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
    ];
    const [create] = AddressLookupTableProgram.createLookupTable({
      authority: payer.publicKey,
      payer: payer.publicKey,
      recentSlot: 1,
    });
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1000 });
    expect(checkMessage(v0([cu, transfer, create, ...ids.map(program)]))).toBeNull();
  });

  test("names any other top-level program", () => {
    const memo = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
    expect(checkMessage(v0([transfer, program(memo)]))).toBe(`program not allowed: ${memo}`);
  });
});

describe("wireSize", () => {
  test("equals the serialized length of a small transfer", () => {
    const tx = new VersionedTransaction(v0([transfer]));
    tx.sign([payer]);
    expect(wireSize(payer.publicKey, [transfer])).toBe(tx.serialize().length);
  });

  test("counts an oversized message instead of throwing", () => {
    const keys = Array.from({ length: 40 }, () => ({
      pubkey: Keypair.generate().publicKey,
      isSigner: false,
      isWritable: true,
    }));
    const big = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys,
      data: Buffer.alloc(8),
    });
    expect(wireSize(payer.publicKey, [big])).toBeGreaterThan(PACKET_LIMIT);
  });
});

test("statusOf maps send outcomes", () => {
  const fail = { err: { InstructionError: [0, { Custom: 6077 }] } };
  expect(statusOf({ sent: false, expectFail: false })).toBe("failed");
  expect(statusOf({ sent: true, expectFail: false })).toBe("unknown");
  expect(statusOf({ sent: true, expectFail: true })).toBe("unknown");
  expect(statusOf({ sent: true, meta: { err: null }, expectFail: false })).toBe("landed");
  expect(statusOf({ sent: true, meta: fail, code: 6077, expectFail: false })).toBe("failed");
  expect(statusOf({ sent: true, meta: fail, code: 6077, expectFail: true })).toBe("landed");
  expect(statusOf({ sent: true, meta: fail, expectFail: true })).toBe("failed");
  expect(statusOf({ sent: true, meta: { err: null }, expectFail: true })).toBe("failed");
});

// A throw mid-send is "unknown" (it may still land) unless preflight rejected it with simulation logs.
test("only a preflight rejection with logs counts as never sent", () => {
  const reject = (logs?: string[]) =>
    new SendTransactionError({ action: "simulate", signature: "", transactionMessage: "x", logs });
  const sent = (e: unknown) => statusOf({ sent: !preflightRejected(e), expectFail: false });
  expect(sent(reject(["Program log: Error: slippage"]))).toBe("failed");
  expect(sent(reject())).toBe("unknown");
  expect(sent(new Error("fetch failed: timeout"))).toBe("unknown");
});

test("pace spaces concurrent callers", async () => {
  const done: number[] = [];
  await Promise.all([0, 1, 2].map(() => pace(40).then(() => done.push(Date.now()))));
  expect(done[2] - done[0]).toBeGreaterThanOrEqual(75);
});

describe("sendRaw", () => {
  const opts = { sig: "SiG", bytes: 10, blockhash: BH, lastValidBlockHeight: 77 };
  const throwing = (e: unknown) =>
    ({
      sendRawTransaction: async () => {
        throw e;
      },
    }) as unknown as Connection;

  test("a preflight rejection with logs is failed: nothing went out", async () => {
    const e = new SendTransactionError({
      action: "simulate",
      signature: "",
      transactionMessage: "x",
      logs: ["Program log: Error: slippage"],
    });
    const r = await sendRaw(throwing(e), new Uint8Array(1), opts);
    expect(r.status).toBe("failed");
    expect(r.sig).toBeUndefined();
  });

  test("a network error is unknown, with the signature and lastValidBlockHeight", async () => {
    const r = await sendRaw(throwing(new Error("fetch failed")), new Uint8Array(1), opts);
    expect(r).toMatchObject({ status: "unknown", sig: "SiG", lastValidBlockHeight: 77 });
  });
});
