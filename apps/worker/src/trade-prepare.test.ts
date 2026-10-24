// prepareTrade with the chain, the route and the quote state stubbed.

import { BN } from "@bondr/core/pump";
import { routeBuy, routeSell } from "@bondr/core/route";
import { budget } from "@bondr/core/send";
import { NATIVE_MINT } from "@solana/spl-token";
import {
  type Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { knownCoins } from "./ingest.ts";
import type { Ctx } from "./status.ts";
import { cuLimitFor, prepareTrade, priorityMicroLamports } from "./trade-prepare.ts";
import { maxSolIn } from "./trade-quote.ts";
import { getTrade } from "./trade-store.ts";

vi.mock("@bondr/core/route", () => ({ routeBuy: vi.fn(), routeSell: vi.fn() }));
vi.mock("./trade-state.ts", () => ({ configs: vi.fn(async () => ({})), mintState: vi.fn(async () => ({})) }));
vi.mock("./trade-quote.ts", async (orig) => ({ ...(await orig<object>()), maxSolIn: vi.fn() }));

const Q = PublicKey.unique();
const COIN = PublicKey.unique();
knownCoins.set(COIN.toBase58(), {
  mint: COIN.toBase58(),
  bondingCurve: "",
  pool: "",
  initialRealTokenReserves: "0",
});
const wallet = Keypair.generate().publicKey;
const AMM = new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");
const BH = Keypair.generate().publicKey.toBase58();
const swap = (programId = AMM) =>
  new TransactionInstruction({
    programId,
    keys: [
      { pubkey: wallet, isSigner: true, isWritable: true },
      { pubkey: COIN, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([9, 9]),
  });
const body = {
  wallet: wallet.toBase58(),
  side: "buy",
  mint: COIN.toBase58(),
  amount: "10000000",
  slippageBps: 100,
};

function ctxWith(sim: { err: unknown; logs?: string[]; unitsConsumed?: number }, net = "devnet") {
  const conn = {
    simulateTransaction: vi.fn(async () => ({ value: { logs: [], unitsConsumed: 155_235, ...sim } })),
    getLatestBlockhash: async () => ({ blockhash: BH, lastValidBlockHeight: 1_150 }),
    getBlockHeight: async () => 1_000,
  };
  const ctx = { conn: conn as unknown as Connection, online: {}, Q, priorityFee: 1_000, net };
  return { conn, ctx: ctx as unknown as Ctx & { net: "devnet" } };
}

const routed = (ixs = [swap()]) => ({
  ixs,
  expectedOut: new BN(500),
  minAmountOut: new BN(495),
  venues: "curve,curve",
});

test("cuLimitFor is the simulated units plus 10%, rounded up", () => {
  expect(cuLimitFor(155_235)).toBe(170_759);
  expect(cuLimitFor(10)).toBe(11);
});

describe("priorityMicroLamports (D-08, Pitfall 2)", () => {
  test("devnet uses the env value without calling the estimator", async () => {
    const estimate = vi.fn(async () => 9_000);
    expect(await priorityMicroLamports("devnet", estimate, 1_000, 200_000)).toBe(1_000);
    expect(estimate).not.toHaveBeenCalled();
  });

  test("mainnet uses the estimate and falls back to the env value when it throws", async () => {
    expect(await priorityMicroLamports("mainnet", async () => 5_000, 1_000, 200_000)).toBe(5_000);
    const broken = async () => {
      throw new Error("Method not found");
    };
    expect(await priorityMicroLamports("mainnet", broken, 1_000, 200_000)).toBe(1_000);
  });

  test("price x limit never passes 0.0005 SOL", async () => {
    const p = await priorityMicroLamports("mainnet", async () => 1e9, 1_000, 170_759);
    expect((p * 170_759) / 1e6).toBeLessThanOrEqual(500_000);
    expect(p).toBe(Math.floor(500_000e6 / 170_759));
    expect(await priorityMicroLamports("devnet", async () => 0, 1e9, 200_000)).toBe(2_500_000);
  });
});

describe("prepareTrade", () => {
  beforeEach(() => {
    vi.mocked(routeBuy).mockReset().mockResolvedValue(routed());
    vi.mocked(routeSell).mockReset().mockResolvedValue(routed());
    vi.mocked(maxSolIn).mockReset();
  });

  test("refuses a devnet buy above maxSolIn and allows it on mainnet (Pitfall 4)", async () => {
    vi.mocked(maxSolIn).mockImplementation((net) => (net === "devnet" ? "9999999" : undefined));
    await expect(prepareTrade(ctxWith({ err: null }).ctx, body)).rejects.toMatchObject({
      status: 400,
      body: { error: "invalid_input" },
    });
    expect(routeBuy).not.toHaveBeenCalled();
    const main = ctxWith({ err: null }, "mainnet").ctx;
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ result: { priorityFeeEstimate: 1_000 } })),
    );
    await expect(prepareTrade(main, body)).resolves.toMatchObject({ expectedOut: "500" });
    vi.unstubAllGlobals();
  });

  test("refuses a missing wallet and bad fields with invalid_input", async () => {
    const { ctx } = ctxWith({ err: null });
    for (const b of [
      { ...body, wallet: undefined },
      { ...body, side: "swap" },
    ])
      await expect(prepareTrade(ctx, b)).rejects.toMatchObject({ status: 400 });
  });

  test("maps the final simulation: 6004 is 409 slippage, custom 1 low lamports is 402", async () => {
    const slip = ctxWith({
      err: { InstructionError: [2, { Custom: 6004 }] },
      logs: ["Program pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA failed: custom program error: 0x1774"],
    }).ctx;
    await expect(prepareTrade(slip, body)).rejects.toMatchObject({
      status: 409,
      body: { error: "slippage" },
    });
    const poor = ctxWith({
      err: { InstructionError: [1, { Custom: 1 }] },
      logs: ["Transfer: insufficient lamports"],
    });
    await expect(prepareTrade(poor.ctx, body)).rejects.toMatchObject({
      status: 402,
      body: { error: "insufficient_balance" },
    });
  });

  test("maps a route throw through textError", async () => {
    vi.mocked(routeSell).mockRejectedValue(
      new Error(
        'multi_hop_swap simulation failed: {"InstructionError":[2,{"Custom":6005}]}\n' +
          "Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P failed: custom program error: 0x1775",
      ),
    );
    await expect(prepareTrade(ctxWith({ err: null }).ctx, { ...body, side: "sell" })).rejects.toMatchObject({
      status: 409,
      body: { error: "paused", paused: "awaiting_migration" },
    });
  });

  test("stores the exact returned message: budget then only the route ixs", async () => {
    const { ctx, conn } = ctxWith({ err: null });
    const r = await prepareTrade(ctx, { ...body, side: "sell" });
    expect(vi.mocked(routeSell).mock.calls[0][0].path).toEqual([COIN, Q, NATIVE_MINT]);
    expect(r).toMatchObject({ expectedOut: "500", minAmountOut: "495", signBy: 60 });
    const stored = getTrade(r.tradeId)?.message;
    const wire = VersionedTransaction.deserialize(Buffer.from(r.tx, "base64"));
    expect(Buffer.from(wire.message.serialize())).toEqual(stored);
    expect(wire.message.staticAccountKeys[0]).toEqual(wallet);
    const want = new TransactionMessage({
      payerKey: wallet,
      recentBlockhash: BH,
      instructions: [...budget(170_759, 1_000), swap()],
    }).compileToV0Message();
    expect(Buffer.from(want.serialize())).toEqual(stored);
    const simmed = conn.simulateTransaction.mock.calls[0] as unknown[];
    expect(simmed[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: true });
  });

  test("refuses a route ix outside the program allowlist with build_failed", async () => {
    vi.mocked(routeBuy).mockResolvedValue(routed([swap(PublicKey.unique())]));
    await expect(prepareTrade(ctxWith({ err: null }).ctx, body)).rejects.toMatchObject({
      body: { error: "build_failed" },
    });
  });
});

// A real devnet build: TRADE_LIVE=1 pnpm vitest run apps/worker/src/trade-prepare.test.ts -t live. It reads the
// dev branch database once and simulates the prepared buy; nothing is signed or sent.
const CU_BUDGET = new PublicKey("ComputeBudget111111111111111111111111111111");
test.skipIf(process.env.TRADE_LIVE !== "1")(
  "live: a 0.01 SOL devnet buy for the sim dev simulates with err null",
  async () => {
    process.loadEnvFile(new URL("../../../.env", import.meta.url));
    for (const mod of ["@bondr/core/route", "./trade-state.ts", "./trade-quote.ts"]) vi.doUnmock(mod);
    vi.resetModules();
    const { prepareTrade: live } = await import("./trade-prepare.ts");
    const { knownCoins: known } = await import("./ingest.ts");
    const { close, db } = await import("@bondr/core/db");
    const { connect } = await import("@bondr/core/net");
    const { derive, readSeed } = await import("@bondr/core/keys");
    const { OnlinePumpSdk } = await import("@bondr/core/pump");
    // The newest real curve coin on the dev branch, as live.e2e.ts picks it (E2E rows are fakes).
    const rows = await db().$client<{ mint: string; bonding_curve: string; pool: string; irtr: string }[]>`
      select c.mint, c.bonding_curve, c.pool, c.initial_real_token_reserves::text as irtr from coins c
      join launches l on l.mint = c.mint
      where l.state = 'landed' and c.venue = 'curve' and l.name not like 'E2E %'
      order by l.created_at desc limit 1`;
    await close();
    const coin = rows[0];
    if (!coin) throw new Error("no curve coin in the dev branch database");
    const { mint, bonding_curve: bondingCurve, pool, irtr: initialRealTokenReserves } = coin;
    known.set(mint, { mint, bondingCurve, pool, initialRealTokenReserves });
    const conn = await connect("devnet");
    const Q = new PublicKey(process.env.BONDR_QUOTE_MINT ?? "");
    const ctx = { conn, online: new OnlinePumpSdk(conn), Q, priorityFee: 1_000, net: "devnet" as const };
    const dev = derive(readSeed(process.env.MASTER_SEED_FILE ?? ""), "sim", "devnet", "dev");
    const r = await live(ctx, { ...body, wallet: dev.publicKey.toBase58(), mint, amount: "10000000" });
    const wire = Buffer.from(r.tx, "base64");
    const tx = VersionedTransaction.deserialize(wire);
    const sim = await conn.simulateTransaction(tx, { sigVerify: false });
    const budgetIx = (tag: number) =>
      tx.message.compiledInstructions.find(
        (ix) => tx.message.staticAccountKeys[ix.programIdIndex]?.equals(CU_BUDGET) && ix.data[0] === tag,
      );
    const cuLimit = Buffer.from(budgetIx(2)?.data ?? []).readUInt32LE(1);
    const price = Buffer.from(budgetIx(3)?.data ?? []).readBigUInt64LE(1);
    const bytes = { wire: wire.length, message: tx.message.serialize().length };
    const facts = { mint, cuLimit, units: sim.value.unitsConsumed, price: String(price), ...bytes };
    process.stderr.write(`${JSON.stringify(facts)}\n`); // vitest hides console output of passing tests
    expect(sim.value.err).toBeNull();
    expect(wire.length).toBeLessThanOrEqual(1232);
    expect(cuLimit).toBeGreaterThan(sim.value.unitsConsumed ?? Infinity);
  },
  60_000,
);
