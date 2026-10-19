// v3 curve trades (buy_exact_quote_in_v3, buy_v3, sell_v3). Every BONDR coin is a Token-2022 mint; the
// quote is SOL (classic program, paid in lamports) or a pump coin (Token-2022).
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { type BN, type Global, PUMP_SDK } from "./pump.ts";

type Side = { global: Global; mint: PublicKey; user: PublicKey; quoteMint: PublicKey };

export const ataIx = (payer: PublicKey, mint: PublicKey, owner: PublicKey) =>
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, true, T22),
    owner,
    mint,
    T22,
  );

const isSol = (q: PublicKey): boolean => q.equals(NATIVE_MINT);

// Pitfall 5: the program never creates the buyback wallet's quote ATA, and the SDK default picks a random
// listed wallet on SOL curves, so the first listed one is passed everywhere.
function accounts(o: Side) {
  const buyback = o.global.buybackFeeRecipients[0];
  const quoteTokenProgram = isSol(o.quoteMint) ? TOKEN_PROGRAM_ID : T22;
  const base = { user: o.user, mint: o.mint, quoteMint: o.quoteMint, tokenProgram: T22, quoteTokenProgram };
  const buybackAta = isSol(o.quoteMint) ? [] : [ataIx(o.user, o.quoteMint, buyback)];
  return { base: { ...base, buybackFeeRecipient: buyback }, buybackAta };
}

// A buy pays from an existing quote balance, so it needs the base ATA and the buyback quote ATA only.
export async function buyExactIn(o: Side & { spend: BN; minOut: BN }): Promise<TransactionInstruction[]> {
  const { base, buybackAta } = accounts(o);
  const ix = await PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
    ...base,
    spendableQuoteIn: o.spend,
    minTokensOut: o.minOut,
  });
  return [ataIx(o.user, o.mint, o.user), ...buybackAta, ix];
}

export async function buyExactOut(o: Side & { amount: BN; maxQuote: BN }): Promise<TransactionInstruction[]> {
  const { base, buybackAta } = accounts(o);
  const ix = await PUMP_SDK.getBuyV3InstructionRaw({ ...base, amount: o.amount, quoteAmount: o.maxQuote });
  return [ataIx(o.user, o.mint, o.user), ...buybackAta, ix];
}

// A sell receives quote, so on a token quote the seller's quote ATA is created too.
export async function sellExactIn(o: Side & { amount: BN; minQuote: BN }): Promise<TransactionInstruction[]> {
  const { base, buybackAta } = accounts(o);
  const ix = await PUMP_SDK.getSellV3InstructionRaw({ ...base, amount: o.amount, quoteAmount: o.minQuote });
  const quoteAta = isSol(o.quoteMint) ? [] : [ataIx(o.user, o.quoteMint, o.user)];
  return [...quoteAta, ...buybackAta, ix];
}
