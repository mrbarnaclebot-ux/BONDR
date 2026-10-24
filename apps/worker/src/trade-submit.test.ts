// submitTrade and viewTrade with the chain stubbed: broadcast, settle and fetchMeta are mocked, messages
// are real v0 messages signed by real keys, as cosign.test.ts builds them.
import { sign } from "node:crypto";
import type { TradeSide } from "@bondr/core/api";
import { signatureOf } from "@bondr/core/cosign";
import {
  type ConfirmedTransactionMeta,
  type Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { putTrade } from "./trade-store.ts";
import { submitTrade, viewTrade } from "./trade-submit.ts";

const m = vi.hoisted(() => ({ broadcast: vi.fn(), settle: vi.fn(), fetchMeta: vi.fn() }));
vi.mock("@bondr/core/send", async (orig) => ({
  ...(await orig<object>()),
  broadcast: m.broadcast,
  settle: m.settle,
  fetchMeta: m.fetchMeta,
}));

const trader = Keypair.generate();
const wallet = trader.publicKey.toBase58();
const MINT = PublicKey.unique();
const BH = PublicKey.unique().toBase58();
const conn = { getBlockHeight: vi.fn(async () => 1_000) };
const ctx = { conn: conn as unknown as Connection };

function prepared(side: TradeSide = "buy") {
  const ix = SystemProgram.transfer({ fromPubkey: trader.publicKey, toPubkey: MINT, lamports: 1 });
  const msg = new TransactionMessage({ payerKey: trader.publicKey, recentBlockhash: BH, instructions: [ix] });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  const message = Buffer.from(tx.message.serialize());
  const e = putTrade({
    wallet,
    mint: MINT.toBase58(),
    side,
    message,
    blockhash: BH,
    lastValidBlockHeight: 1_100,
  });
  return { e, tx };
}

// Slot 0 holds kp's Ed25519 signature over the message, whoever kp is.
const signedBy = (tx: VersionedTransaction, kp = trader) => {
  const [d, x] = [kp.secretKey.subarray(0, 32), kp.publicKey.toBytes()].map((b) =>
    Buffer.from(b).toString("base64url"),
  );
  const key = { key: { kty: "OKP", crv: "Ed25519", d, x }, format: "jwk" } as const;
  tx.addSignature(trader.publicKey, new Uint8Array(sign(null, tx.message.serialize(), key)));
  return Buffer.from(tx.serialize()).toString("base64");
};
const body = (tradeId: string, signed: string, w = wallet) => ({ tradeId, signed, wallet: w });

const meta = (o: Partial<ConfirmedTransactionMeta>) =>
  ({
    fee: 5_000,
    preBalances: [0],
    postBalances: [0],
    preTokenBalances: [],
    postTokenBalances: [],
    ...o,
  }) as ConfirmedTransactionMeta;

beforeEach(() => {
  vi.resetAllMocks();
  conn.getBlockHeight.mockResolvedValue(1_000);
  m.broadcast.mockResolvedValue(null);
  m.settle.mockReturnValue(new Promise(() => {})); // in flight unless a test settles it
});

describe("submitTrade refuses (T3, T5)", () => {
  test("one flipped message byte or another signer is 422 message_changed and nothing is sent", async () => {
    const a = prepared();
    const wire = Buffer.from(signedBy(a.tx), "base64");
    wire[wire.length - 1] ^= 1;
    await expect(submitTrade(ctx, body(a.e.id, wire.toString("base64")))).rejects.toMatchObject({
      status: 422,
      body: { error: "message_changed" },
    });
    const b = prepared();
    await expect(submitTrade(ctx, body(b.e.id, signedBy(b.tx, Keypair.generate())))).rejects.toMatchObject({
      status: 422,
      body: { error: "message_changed" },
    });
    expect(m.broadcast).not.toHaveBeenCalled();
  });

  test("another wallet's trade and a missing one are 404 not_found", async () => {
    const { e, tx } = prepared();
    const other = Keypair.generate().publicKey.toBase58();
    await expect(submitTrade(ctx, body(e.id, signedBy(tx), other))).rejects.toMatchObject({ status: 404 });
    await expect(submitTrade(ctx, body("b".repeat(32), signedBy(tx)))).rejects.toMatchObject({ status: 404 });
    expect(() => viewTrade(body(e.id, "", other))).toThrow(expect.objectContaining({ status: 404 }));
  });

  test("bad fields are 400 invalid_input", async () => {
    const { e, tx } = prepared();
    for (const b of [body("x", signedBy(tx)), body(e.id, ""), body(e.id, signedBy(tx), "nope")])
      await expect(submitTrade(ctx, b)).rejects.toMatchObject({ status: 400 });
  });

  test("past lastValidBlockHeight is 410 expired, the trade fails with code expired", async () => {
    conn.getBlockHeight.mockResolvedValue(1_101);
    const { e, tx } = prepared();
    await expect(submitTrade(ctx, body(e.id, signedBy(tx)))).rejects.toMatchObject({
      status: 410,
      body: { error: "expired" },
    });
    expect(viewTrade(body(e.id, ""))).toEqual({ state: "failed", code: "expired" });
    expect(m.broadcast).not.toHaveBeenCalled();
  });
});

describe("submitTrade sends once (D-06)", () => {
  test("an accepted send answers sent with the signature; a repeat submit is a read", async () => {
    const { e, tx } = prepared();
    const signed = signedBy(tx);
    const first = await submitTrade(ctx, body(e.id, signed));
    expect(first).toEqual({ state: "sent", signature: signatureOf(Buffer.from(signed, "base64")) });
    expect(await submitTrade(ctx, body(e.id, signedBy(tx)))).toEqual(first);
    expect(m.broadcast).toHaveBeenCalledTimes(1);
    expect(m.broadcast.mock.calls[0][2]).toMatchObject({ paceMs: 1100, lastValidBlockHeight: 1_100 });
    expect(m.settle).toHaveBeenCalledTimes(1);
  });

  test("a preflight rejection fails with the mapped code (6004 is slippage)", async () => {
    m.broadcast.mockResolvedValue({
      ok: false,
      status: "failed",
      bytes: 1,
      err: "ExceededSlippage: Transaction simulation failed: custom program error: 0x1774",
    });
    const { e, tx } = prepared();
    const r = await submitTrade(ctx, body(e.id, signedBy(tx)));
    expect(r).toMatchObject({ state: "failed", code: "slippage" });
    expect(m.settle).not.toHaveBeenCalled();
  });
});

describe("settle in the background", () => {
  const landed = { ok: true, status: "landed", bytes: 1 };
  const run = async (side: TradeSide, result: object) => {
    m.settle.mockResolvedValue(result);
    const { e, tx } = prepared(side);
    await submitTrade(ctx, body(e.id, signedBy(tx)));
    await vi.waitFor(() => expect(viewTrade(body(e.id, "")).state).not.toBe("sent"));
    return viewTrade(body(e.id, ""));
  };

  test("a landed buy reports the tokens received, a landed sell the lamports paid", async () => {
    const bal = (amount: string) => ({
      accountIndex: 1,
      mint: MINT.toBase58(),
      owner: wallet,
      uiTokenAmount: { amount, decimals: 6, uiAmount: null },
    });
    m.fetchMeta.mockResolvedValue(meta({ preTokenBalances: [bal("10")], postTokenBalances: [bal("510")] }));
    expect(await run("buy", landed)).toMatchObject({ state: "landed", amountOut: "500" });
    m.fetchMeta.mockResolvedValue(meta({ preBalances: [1_000_000], postBalances: [1_495_000] }));
    expect(await run("sell", landed)).toMatchObject({ state: "landed", amountOut: "500000" });
  });

  test("failed on chain: 6004 is slippage, other codes onchain", async () => {
    const failed = { ok: false, status: "failed", bytes: 1 };
    expect(await run("buy", { ...failed, code: 6004 })).toMatchObject({ state: "failed", code: "slippage" });
    expect(await run("buy", { ...failed, code: 6001 })).toMatchObject({ state: "failed", code: "onchain" });
  });

  test("unknown stays unknown with its signature and is never resent", async () => {
    const v = await run("buy", { ok: false, status: "unknown", bytes: 1 });
    expect(v).toEqual({ state: "unknown", signature: expect.any(String) });
    expect(m.broadcast).toHaveBeenCalledTimes(1);
  });
});
