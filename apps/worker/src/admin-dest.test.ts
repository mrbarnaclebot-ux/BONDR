import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  createAssociatedTokenAccountInstruction,
  createBurnCheckedInstruction,
  createBurnInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  type PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { expect, test } from "vitest";
import { allowFor, passedLines, refusedDestination } from "./admin-dest.ts";

const key = () => Keypair.generate().publicKey;
const [treasury, buyback, deployer, w, ops, stranger, bondr, coin] = Array.from({ length: 8 }, key);
const T22 = TOKEN_2022_PROGRAM_ID;
const ata = (owner: PublicKey, mint = bondr, program = T22) =>
  getAssociatedTokenAddressSync(mint, owner, true, program);

const finalize = allowFor({ treasury, deployer, internal: [w], mints: [bondr, coin], closeTo: treasury });
const sweep = allowFor({ treasury, buyback, internal: [w], mints: [bondr, coin], closeTo: treasury });
const wAta = ata(w);

const sol = (to: PublicKey) => SystemProgram.transfer({ fromPubkey: ops, toPubkey: to, lamports: 1 });
const t22 = (to: PublicKey) => createTransferCheckedInstruction(wAta, bondr, to, w, 1n, 6, [], T22);
const pumpIx = new TransactionInstruction({
  programId: Keypair.generate().publicKey,
  keys: [{ pubkey: stranger, isSigner: false, isWritable: true }],
  data: Buffer.from([9]),
});

const cases: [string, TransactionInstruction[], ReturnType<typeof allowFor>, PublicKey | null][] = [
  ["System Transfer to the treasury", [sol(treasury)], sweep, null],
  ["System Transfer to the coin's own W", [sol(w)], sweep, null],
  ["System Transfer to an unknown key", [sol(stranger)], sweep, stranger],
  ["Token-2022 TransferChecked to the treasury's BONDR ATA", [t22(ata(treasury))], sweep, null],
  [
    "TransferChecked to the deployer's ATA when the deployer is allowed",
    [t22(ata(deployer))],
    finalize,
    null,
  ],
  ["TransferChecked to the deployer's ATA when it is not", [t22(ata(deployer))], sweep, ata(deployer)],
  ["TransferChecked to an unknown owner's ATA", [t22(ata(stranger))], sweep, ata(stranger)],
  [
    "legacy Token Transfer to an allowed ATA",
    [createTransferInstruction(ata(w, coin, TOKEN_PROGRAM_ID), ata(buyback, coin, TOKEN_PROGRAM_ID), w, 1n)],
    sweep,
    null,
  ],
  ["BurnChecked", [createBurnCheckedInstruction(wAta, bondr, w, 1n, 6, [], T22)], sweep, null],
  ["Burn", [createBurnInstruction(wAta, bondr, w, 1n, [], T22)], sweep, null],
  ["CloseAccount to the treasury", [createCloseAccountInstruction(wAta, treasury, w, [], T22)], sweep, null],
  ["CloseAccount to the buyback", [createCloseAccountInstruction(wAta, buyback, w, [], T22)], sweep, buyback],
  [
    "Approve (a delegate is an outflow in disguise)",
    [createApproveInstruction(wAta, stranger, w, 1n, [], T22)],
    sweep,
    wAta,
  ],
  [
    "ATA create and createIdempotent",
    [
      createAssociatedTokenAccountInstruction(
        ops,
        ata(stranger),
        stranger,
        bondr,
        T22,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
      createAssociatedTokenAccountIdempotentInstruction(ops, ata(stranger), stranger, bondr, T22),
    ],
    sweep,
    null,
  ],
  [
    "System CreateAccount funded by W (WR-W-04)",
    [
      SystemProgram.createAccount({
        fromPubkey: w,
        newAccountPubkey: stranger,
        lamports: 1,
        space: 0,
        programId: w,
      }),
    ],
    sweep,
    w,
  ],
  [
    "System Assign of W to another program",
    [SystemProgram.assign({ accountPubkey: w, programId: stranger })],
    sweep,
    w,
  ],
  [
    "System WithdrawNonceAccount",
    [
      SystemProgram.nonceWithdraw({
        ...{ noncePubkey: w, authorizedPubkey: w, toPubkey: stranger, lamports: 1 },
      }),
    ],
    sweep,
    w,
  ],
  ["ComputeBudget", [ComputeBudgetProgram.setComputeUnitLimit({ units: 1 })], sweep, null],
  // signTx's ALLOWED_PROGRAMS refuses an unknown program at signing; pump flows are trusted through it.
  ["an instruction from another program", [pumpIx], sweep, null],
  [
    "the first refused instruction is named",
    [sol(treasury), t22(ata(stranger)), sol(stranger)],
    sweep,
    ata(stranger),
  ],
];

test.each(cases)("%s", (_name, ixs, allowed, refused) => {
  expect(refusedDestination(ixs, allowed)).toBe(refused?.toBase58() ?? null);
});

test("names each allowed owner and its ATAs under both token programs", () => {
  expect(sweep.owners.get(treasury.toBase58())).toBe("Treasury");
  expect(sweep.owners.get(buyback.toBase58())).toBe("Buyback");
  expect(finalize.owners.get(deployer.toBase58())).toBe(`Deployer ${deployer.toBase58().slice(0, 4)}...`);
  expect(sweep.owners.get(w.toBase58())).toBe(`W ${w.toBase58().slice(0, 4)}...`);
  expect(sweep.atas.get(ata(treasury, coin, TOKEN_PROGRAM_ID).toBase58())).toBe("Treasury");
  expect(sweep.closeTo).toBe(treasury.toBase58());
  expect(sweep.mints).toEqual([bondr.toBase58(), coin.toBase58()]);
});

test("passed lines read as the dialog copy", () => {
  expect(passedLines(finalize)).toEqual(["deployer matches the launch signer", "treasury matches config"]);
  expect(passedLines(sweep)).toEqual(["treasury matches config", "buyback matches config"]);
  const held = allowFor({
    treasury,
    deployer,
    internal: [w],
    mints: [bondr],
    closeTo: treasury,
    recorded: true,
  });
  expect(passedLines(held)[0]).toBe("deployer is the recorded launch wallet"); // WR-W-03: no signer proof ran
  expect(passedLines(allowFor({ internal: [w], mints: [coin], closeTo: treasury }))).toEqual(["burn only"]);
});
