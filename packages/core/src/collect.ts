// Pre-bond creator fee collect and the off-chain 90/10 split (PROJECT.md item 4). Both legs keep W's fees in
// one quote mint, the stand-in Q, a Token-2022 mint.
import {
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type OnlinePumpSdk, PUMP_SDK } from "./pump.ts";
import { ataIx } from "./trade.ts";

type Online = InstanceType<typeof OnlinePumpSdk>;

// [W's Q ATA, sweep, collect]. v3 trades leave creator fees on the curve until the sweep moves them to W's
// vault (Pitfall 6), so the sweep goes first in the same tx. Collect is permissionless: W does not sign.
// sweepCurve false: after finalize the curve names the sharing config, so a sweep naming W fails; the collect
// alone still empties W's own vaults.
export async function collectIxs(o: {
  online: Online;
  payer: PublicKey;
  mint: PublicKey;
  creator: PublicKey;
  quoteMint: PublicKey;
  sweepCurve?: boolean;
}): Promise<TransactionInstruction[]> {
  const q = { payer: o.payer, mint: o.mint, creator: o.creator, quoteMint: o.quoteMint };
  const sweep =
    o.sweepCurve === false
      ? []
      : [await PUMP_SDK.sweepCreatorFeeInstruction({ ...q, quoteTokenProgram: T22 })];
  return [
    ataIx(o.payer, o.quoteMint, o.creator),
    ...sweep,
    ...(await o.online.collectCoinCreatorFeeV2Instructions(o.creator, o.quoteMint, T22, o.payer)),
  ];
}

// The treasury tenth leaves W; the destination is always the treasury's derived ATA (T-01-20). W signs.
export function splitIxs(o: {
  payer: PublicKey;
  creator: PublicKey;
  treasury: PublicKey;
  quoteMint: PublicKey;
  treasuryAmount: bigint;
  decimals: number;
}): TransactionInstruction[] {
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(o.quoteMint, owner, true, T22);
  return [
    ataIx(o.payer, o.quoteMint, o.treasury),
    createTransferCheckedInstruction(
      ata(o.creator),
      o.quoteMint,
      ata(o.treasury),
      o.creator,
      o.treasuryAmount,
      o.decimals,
      [],
      T22,
    ),
  ];
}

// D-12 window sweep: W's BONDR goes 90% to the buyback and 10% to the treasury in one tx W signs. The
// destinations are only ever the two derived ATAs (T-01-20); a zero leg is left out.
export function sweepIxs(o: {
  payer: PublicKey;
  w: PublicKey;
  buyback: PublicKey;
  treasury: PublicKey;
  quoteMint: PublicKey;
  buybackAmount: bigint;
  treasuryAmount: bigint;
  decimals: number;
}): TransactionInstruction[] {
  const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(o.quoteMint, owner, true, T22);
  const legs = (
    [
      [o.buyback, o.buybackAmount],
      [o.treasury, o.treasuryAmount],
    ] as const
  ).filter(([, x]) => x > 0n);
  return [
    ...legs.map(([owner]) => ataIx(o.payer, o.quoteMint, owner)),
    ...legs.map(([owner, x]) =>
      createTransferCheckedInstruction(ata(o.w), o.quoteMint, ata(owner), o.w, x, o.decimals, [], T22),
    ),
  ];
}
