// The finalize split (A2) and the chain-read finalize state. Builders run offline on fixed keys; the state
// read uses a stub connection and stubbed SDK decoders, so no RPC is needed.
import { type AccountInfo, type Connection, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { afterEach, expect, test, vi } from "vitest";
import { bondingCurvePda, canonicalPumpPoolPdaWithQuote, feeSharingConfigPda, PUMP_SDK } from "./pump.ts";
import { configSweeps, finalizeConfigIxs, finalizeIxs, finalizeState, finalizeUpdateIxs } from "./sharing.ts";

const key = () => PublicKey.unique();
const [payer, mint, creator, quoteMint, deployer, treasury] = [key(), key(), key(), key(), key(), key()];
const pool = canonicalPumpPoolPdaWithQuote(mint, quoteMint);
const o = { payer, mint, creator, quoteMint, deployer, treasury, bondingCurveComplete: true, pool };

const shape = (ixs: TransactionInstruction[]) =>
  ixs.map((ix) => ({
    program: ix.programId.toBase58(),
    data: ix.data.toString("hex"),
    keys: ix.keys.map((k) => k.pubkey.toBase58()),
  }));

afterEach(() => vi.restoreAllMocks());

test("finalizeConfigIxs on a bonded coin is finalizeIxs without its last two", async () => {
  const all = await finalizeIxs(o);
  expect(shape(await finalizeConfigIxs(o))).toEqual(shape(all.slice(0, -2)));
});

test("finalizeUpdateIxs is the config sweeps, the vault ATA and the update to FINAL_SHARES", async () => {
  const tail = (await finalizeIxs(o)).slice(-2);
  const want = [...(await configSweeps(o)), ...tail];
  expect(shape(await finalizeUpdateIxs(o))).toEqual(shape(want));
});

const info = { data: Buffer.alloc(8), executable: false, lamports: 1, owner: PublicKey.default };

function stub(present: [boolean, boolean, boolean]) {
  const seen: PublicKey[][] = [];
  const conn = {
    getMultipleAccountsInfo: async (keys: PublicKey[]) => {
      seen.push(keys);
      return present.map((p) => (p ? info : null)) as (AccountInfo<Buffer> | null)[];
    },
  } as unknown as Connection;
  return { conn, seen };
}

test("finalizeState: none, revoked and configured, all from one getMultipleAccountsInfo", async () => {
  vi.spyOn(PUMP_SDK, "decodeBondingCurve").mockReturnValue({ complete: true } as never);
  const revoked = vi.spyOn(PUMP_SDK, "decodeSharingConfig").mockReturnValue({ adminRevoked: true } as never);
  const none = stub([true, true, false]);
  expect(await finalizeState(none.conn, mint, quoteMint)).toEqual({
    complete: true,
    pool,
    sharing: "none",
  });
  expect(none.seen).toEqual([[bondingCurvePda(mint), pool, feeSharingConfigPda(mint)]]);
  const both = stub([true, true, true]);
  expect((await finalizeState(both.conn, mint, quoteMint)).sharing).toBe("revoked");
  revoked.mockReturnValue({ adminRevoked: false } as never);
  expect((await finalizeState(both.conn, mint, quoteMint)).sharing).toBe("configured");
  expect(both.seen).toHaveLength(2);
});

test("finalizeState: no curve reads as not complete, no pool as null", async () => {
  const s = await finalizeState(stub([false, false, false]).conn, mint, quoteMint);
  expect(s).toEqual({ complete: false, pool: null, sharing: "none" });
});
