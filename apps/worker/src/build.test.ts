// The Sender tip in compileLaunch (D-34, LAUNCH-08): placed outside the lookup table, dropped when it would break
// the packet limit, and priced as a fee, not as create cost (Pitfall 2). Synthetic keys, no RPC.
import { budget, messageSize, PACKET_LIMIT } from "@bondr/core/send";
import {
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { afterEach, expect, test, vi } from "vitest";
import { compileLaunch, previewCosts, tipped } from "./build.ts";
import { SENDER_TIPS } from "./fee-config.ts";
import { tipIxs } from "./fee-send.ts";

const [dev, mint] = [Keypair.generate().publicKey, Keypair.generate().publicKey];
const ata = getAssociatedTokenAddressSync(mint, dev, true, TOKEN_2022_PROGRAM_ID);
const filler = Array.from({ length: 6 }, () => Keypair.generate().publicKey);
const table = new AddressLookupTableAccount({
  key: Keypair.generate().publicKey,
  state: {
    deactivationSlot: BigInt("18446744073709551615"),
    lastExtendedSlot: 0,
    lastExtendedSlotStartIndex: 0,
    addresses: [ata, ...filler],
  },
});
const bh = PublicKey.default.toBase58();
const o = { dev, mint, exit: "burn" as const };

// The mint signs (create) and the dev burns its whole buy: the shape compileLaunch checks for.
const base = (): TransactionInstruction[] => [
  ...budget(200_000),
  SystemProgram.createAccount({
    fromPubkey: dev,
    newAccountPubkey: mint,
    lamports: 1,
    space: 0,
    programId: dev,
  }),
  new TransactionInstruction({
    programId: SystemProgram.programId,
    keys: filler.map((pubkey) => ({ pubkey, isSigner: false, isWritable: true })),
    data: Buffer.alloc(4),
  }),
  createBurnCheckedInstruction(ata, mint, dev, 1n, 6, [], TOKEN_2022_PROGRAM_ID),
];
const tip = (net: "mainnet" | "devnet") => tipIxs(net, dev, 1_000_000, () => 0);

afterEach(() => vi.restoreAllMocks());

test("mainnet: the tip transfer is in the message and its account is a static key, never a table key", () => {
  const msg = compileLaunch(o, base(), table, bh, tip("mainnet"));
  expect(tipped(msg)).toBe(true);
  const statics = msg.staticAccountKeys.map(String);
  expect(statics).toContain(SENDER_TIPS[0]);
  expect(table.state.addresses.map(String)).not.toContain(SENDER_TIPS[0]);
  expect(msg.header.numRequiredSignatures).toBe(2);
});

test("devnet: no tip instructions, so no transfer and not tipped", () => {
  expect(tip("devnet")).toEqual([]);
  expect(tipped(compileLaunch(o, base(), table, bh, tip("devnet")))).toBe(false);
});

test("a transfer to an account that is not a Sender tip account is not tipped", () => {
  const other = SystemProgram.transfer({ fromPubkey: dev, toPubkey: filler[0] as PublicKey, lamports: 1 });
  expect(tipped(compileLaunch(o, base(), table, bh, [other]))).toBe(false);
});

test("a tipped message over the packet limit compiles without the tip and warns once (never fails)", () => {
  const size0 = messageSize(compileLaunch(o, base(), table, bh));
  // A ComputeBudget instruction with a padded payload adds its data plus 4 bytes (index, count, compact length).
  const pad = new TransactionInstruction({
    programId: ComputeBudgetProgram.programId,
    keys: [],
    data: Buffer.alloc(PACKET_LIMIT - 10 - size0 - 4),
  });
  const ixs = [...base(), pad];
  expect(messageSize(compileLaunch(o, ixs, table, bh))).toBeLessThanOrEqual(PACKET_LIMIT);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const msg = compileLaunch(o, ixs, table, bh, tip("mainnet"));
  expect(tipped(msg)).toBe(false);
  expect(messageSize(msg)).toBeLessThanOrEqual(PACKET_LIMIT);
  expect(warn).toHaveBeenCalledTimes(1);
});

test("previewCosts with the tip folded into the fee keeps it out of the create cost (Pitfall 2)", () => {
  const [solIn, fee, tipLamports] = [100n, 10n, 1_000n];
  expect(previewCosts(solIn, fee + tipLamports, 5_000n)).toEqual({
    createCost: 5_000n - solIn - fee - tipLamports,
    solBack: null,
  });
});
