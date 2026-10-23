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
import {
  type BN,
  buyQuoteInput,
  canonicalPumpPoolPdaWithQuote,
  type Global,
  type OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  PUMP_SDK,
} from "./pump.ts";

type Side = { global: Global; mint: PublicKey; user: PublicKey; quoteMint: PublicKey };
type Amm = InstanceType<typeof OnlinePumpAmmSdk>;
type Pool = { amm: Amm; mint: PublicKey; quoteMint: PublicKey; user: PublicKey };

export const ataIx = (payer: PublicKey, mint: PublicKey, owner: PublicKey, program = T22) =>
  createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, true, program),
    owner,
    mint,
    program,
  );

const isSol = (q: PublicKey): boolean => q.equals(NATIVE_MINT);
const quoteProgram = (q: PublicKey): PublicKey => (isSol(q) ? TOKEN_PROGRAM_ID : T22);

// PumpSwap v2 needs the buyback wallet's quote ATA on SOL pools too, unlike the v3 curve, which pays a SOL
// buyback in lamports. Fork check on migrated Q's SOL pool (2026-10-19): with that WSOL ATA emptied, buy_v2
// fails 6027 AccountTypeNotSupported, a Token-2022 create fails IncorrectProgramId, and a classic create
// lands. On mainnet all 8 listed buyback wallets already hold one, so the create is a no-op there.
export const buybackAtaIx = (payer: PublicKey, quoteMint: PublicKey, buyback: PublicKey) =>
  ataIx(payer, quoteMint, buyback, quoteProgram(quoteMint));

// Pitfall 5: the program never creates the buyback wallet's quote ATA, and the SDK default picks a random
// listed wallet on SOL curves, so the first listed one is passed everywhere.
export function buybackRecipient(g: Global): PublicKey {
  const buyback = g.buybackFeeRecipients[0];
  if (!buyback) throw new Error("pump Global has no buybackFeeRecipients");
  return buyback;
}

function accounts(o: Side) {
  const buyback = buybackRecipient(o.global);
  const quoteTokenProgram = quoteProgram(o.quoteMint);
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

// The one PumpSwap state fetch. The SDK picks a random listed buyback wallet and v2 never creates its quote
// ATA, so the first listed one is pinned and the caller creates its ATA (Pitfall 5).
export async function poolState(o: Pool) {
  const s = await o.amm.swapSolanaState(canonicalPumpPoolPdaWithQuote(o.mint, o.quoteMint), o.user);
  const buyback = s.globalConfig.buybackFeeRecipients[0];
  if (!buyback) throw new Error("PumpSwap GlobalConfig has no buyback fee recipients");
  return { state: { ...s, globalConfig: { ...s.globalConfig, buybackFeeRecipients: [buyback] } }, buyback };
}

export type PoolState = Awaited<ReturnType<typeof poolState>>;

// The base a quote buys on the pool, after fees (pump-swap-sdk's own calculator, no slippage applied).
export function poolBaseFor(s: PoolState["state"], quote: BN): BN {
  return buyQuoteInput({
    quote,
    slippage: 0,
    baseReserve: s.poolBaseAmount,
    quoteReserve: s.poolQuoteAmount,
    virtualQuoteReserves: s.pool.virtualQuoteReserves,
    globalConfig: s.globalConfig,
    baseMintAccount: s.baseMintAccount,
    baseMint: s.pool.baseMint,
    coinCreator: s.pool.coinCreator,
    creator: s.pool.creator,
    feeConfig: s.feeConfig,
    quoteMint: s.pool.quoteMint,
    isMayhemMode: s.pool.isMayhemMode,
    creatorFeeBps: s.pool.creatorFeeBps,
  }).base;
}

// PumpSwap buy_v2 of exactly baseOut; the SDK creates the user's base ATA when missing. `fetched` reuses a
// state the caller already priced from, so the buy and its quote see the same pool.
export async function poolBuy(
  o: Pool & { baseOut: BN; maxQuoteIn: BN; fetched?: PoolState },
): Promise<TransactionInstruction[]> {
  const { state, buyback } = o.fetched ?? (await poolState(o));
  const buy = await PUMP_AMM_SDK.buyV2Instructions(state, o.baseOut, o.maxQuoteIn);
  return [buybackAtaIx(o.user, o.quoteMint, buyback), ...buy];
}

// PumpSwap sell_v2 of exactly baseIn; the SDK creates the user's quote ATA when missing.
export async function poolSell(o: Pool & { baseIn: BN; minQuoteOut: BN }): Promise<TransactionInstruction[]> {
  const { state, buyback } = await poolState(o);
  const sell = await PUMP_AMM_SDK.sellV2Instructions(state, o.baseIn, o.minQuoteOut);
  return [buybackAtaIx(o.user, o.quoteMint, buyback), ...sell];
}
