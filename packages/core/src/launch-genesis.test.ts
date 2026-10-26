// buildGenesis (D-28): BONDR's own SOL-pair launch with the treasury as creator and the dev buy burned in the
// same transaction. Built offline over a stubbed Global; the fork rehearsal (07-21) runs it against real programs.
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID as T22 } from "@solana/spl-token";
import { Keypair, PublicKey, TransactionMessage } from "@solana/web3.js";
import { expect, test } from "vitest";
import { exitPresent } from "./cosign.ts";
import { buildCreate, buildGenesis, type LaunchOpts } from "./launch.ts";
import {
  BN,
  type FeeConfig,
  type Global,
  getBuyV3TokenAmountFromQuoteAmount,
  newBondingCurve,
  PUMP_PROGRAM_ID,
} from "./pump.ts";

const bps = (lp: number, protocol: number, creator: number) => ({
  lpFeeBps: new BN(lp),
  protocolFeeBps: new BN(protocol),
  creatorFeeBps: new BN(creator),
});
// A SOL coin takes the market-cap tiers; one tier is enough here.
const feeTiers = [{ marketCapLamportsThreshold: new BN(0), fees: bps(0, 95, 30) }];
const feeConfig = {
  flatFees: bps(0, 95, 30),
  exoticFlatFees: bps(0, 0, 0),
  feeTiers,
} as unknown as FeeConfig;
const global = {
  creatorFeeConfigurable: false,
  whitelistedQuoteMints: [],
  initialVirtualQuoteReserves: new BN(30_000_000_000),
  initialVirtualSolReserves: new BN(30_000_000_000),
  initialVirtualTokenReserves: new BN(1_073_000_000_000_000),
  initialRealTokenReserves: new BN(793_100_000_000_000),
  tokenTotalSupply: new BN(1_000_000_000_000_000),
  mayhemModeEnabled: false,
  feeBasisPoints: new BN(95),
  creatorFeeBasisPoints: new BN(30),
  feeRecipient: Keypair.generate().publicKey,
  feeRecipients: Array.from({ length: 7 }, () => Keypair.generate().publicKey),
  buybackFeeRecipients: [Keypair.generate().publicKey],
} as unknown as Global;
const online = {
  fetchGlobal: async () => global,
  fetchFeeConfig: async () => feeConfig,
} as unknown as LaunchOpts["online"];

const coin = { name: "BONDR", symbol: "BONDR", uri: "https://ipfs.io/ipfs/bafkreigenesis" };
const [mint, dev, treasury] = [0, 1, 2].map(() => Keypair.generate().publicKey) as [
  PublicKey,
  PublicKey,
  PublicKey,
];
const solIn = new BN(1_000_000_000);
const build = () => buildGenesis({ ...coin, online, mint, dev, treasury, solIn, cuLimit: 300_000 });
const u64 = (data: Uint8Array, at: number) => Buffer.from(data).readBigUInt64LE(at);

test("the create is a SOL coin with the treasury as creator: fewer accounts than a quoted create", async () => {
  const { ixs } = await build();
  const create = ixs.find((ix) => ix.programId.equals(PUMP_PROGRAM_ID));
  const quoted = await buildCreate({
    ...coin,
    mint,
    creator: treasury,
    user: dev,
    quoteMint: PublicKey.unique(),
  });
  expect(create?.keys.length).toBeLessThan(quoted.keys.length);
  expect(Buffer.from(create?.data ?? []).includes(treasury.toBuffer())).toBe(true);
  expect(create?.keys.some((k) => k.pubkey.equals(dev) && k.isSigner)).toBe(true);
});

test("the buy takes exactly 98% of what solIn buys on a fresh SOL curve and spends at most solIn", async () => {
  const { ixs, amount } = await build();
  const out = getBuyV3TokenAmountFromQuoteAmount({
    global,
    feeConfig,
    mintSupply: global.tokenTotalSupply,
    bondingCurve: newBondingCurve(global),
    amount: solIn,
    curveBaseTokenBalance: global.tokenTotalSupply,
  });
  expect(amount.toString()).toBe(out.muln(9800).divn(10_000).toString());
  const buy = ixs.filter((ix) => ix.programId.equals(PUMP_PROGRAM_ID))[1];
  expect(buy && u64(buy.data, 8)).toBe(BigInt(amount.toString()));
  expect(buy && u64(buy.data, 16)).toBe(BigInt(solIn.toString()));
});

test("the last instruction burns exactly the bought amount from the dev's Token-2022 ATA, signed by the dev", async () => {
  const { ixs, amount } = await build();
  const burn = ixs.at(-1);
  const ata = getAssociatedTokenAddressSync(mint, dev, true, T22);
  expect(burn?.programId.equals(T22)).toBe(true);
  expect(burn?.data[0]).toBe(15); // BurnChecked
  expect(burn && u64(burn.data, 1)).toBe(BigInt(amount.toString()));
  expect(burn?.keys.map((k) => k.pubkey.toBase58())).toEqual([ata, mint, dev].map(String));
  expect(burn?.keys[2]?.isSigner).toBe(true);
});

test("exitPresent finds the burn, so the worker's co-sign rule holds unchanged for genesis", async () => {
  const { ixs } = await build();
  const msg = new TransactionMessage({
    payerKey: dev,
    recentBlockhash: PublicKey.unique().toBase58(),
    instructions: ixs,
  }).compileToV0Message([]);
  expect(exitPresent(msg, [], { exit: "burn", mint, dev })).toBe(true);
  expect(exitPresent(msg, [], { exit: "burn", mint, dev: treasury })).toBe(false);
});
