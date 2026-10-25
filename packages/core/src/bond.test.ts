// WR-08: a leftover child token in W must not raise the forced bond's minOut, and the burn takes all W holds.
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { type Connection, Keypair, PublicKey } from "@solana/web3.js";
import { expect, test } from "vitest";
import { forcedBondIxs } from "./bond.ts";
import { BN, type Global } from "./pump.ts";

const tokenAccount = (amount: bigint) => {
  const b = Buffer.alloc(165);
  b.writeBigUInt64LE(amount, 64);
  return b;
};

function fakeConn(pre: bigint | null, post: bigint) {
  return {
    getAccountInfo: async () => (pre === null ? null : { data: tokenAccount(pre) }),
    getLatestBlockhash: async () => ({ blockhash: PublicKey.default.toBase58(), lastValidBlockHeight: 1 }),
    simulateTransaction: async () => ({
      value: { err: null, accounts: [{ data: [tokenAccount(post).toString("base64"), "base64"] }] },
    }),
  } as unknown as Connection;
}

async function bond(pre: bigint | null, post: bigint) {
  const [ops, w, mint, quoteMint] = [0, 1, 2, 3].map(() => Keypair.generate().publicKey) as PublicKey[];
  const global = { buybackFeeRecipients: [Keypair.generate().publicKey] } as unknown as Global;
  const o = { ops, w, wFloatLamports: 0, global, mint, quoteMint, budget: new BN(1000) };
  const { ixs, burnAmount } = await forcedBondIxs({ ...o, conn: fakeConn(pre, post) } as never);
  const ata = getAssociatedTokenAddressSync(mint as PublicKey, w as PublicKey, true, T22);
  const burn = ixs.at(-1);
  const buy = ixs.at(-2);
  return {
    burnAmount: BigInt(burnAmount.toString()),
    burned: burn?.data.readBigUInt64LE(1),
    burnFrom: burn?.keys[0]?.pubkey.equals(ata),
    minOut: buy?.data.readBigUInt64LE(16), // discriminator, spendableQuoteIn, minTokensOut
  };
}

test("forcedBondIxs floors the buy at the simulated out minus W's prior balance and burns it all", async () => {
  expect(await bond(7n, 500n)).toEqual({ burnAmount: 500n, burned: 500n, burnFrom: true, minOut: 493n });
});

test("forcedBondIxs with no child ATA in W keeps minOut at the simulated out", async () => {
  expect(await bond(null, 500n)).toMatchObject({ burned: 500n, minOut: 500n });
});

test("forcedBondIxs refuses a simulation that buys nothing", async () => {
  await expect(bond(500n, 500n)).rejects.toThrow("not above");
});
