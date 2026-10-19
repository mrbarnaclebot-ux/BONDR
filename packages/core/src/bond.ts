// The forced bond and its fallback (RESEARCH Pattern 4). W buys and burns in the same tx, so a bought token
// never sits in W, and on mainnet pump's keeper cannot migrate between completion and the burn. Every W tx
// starts with an ops -> W lamport float, because the buys charge rent to W (Pitfall 3).
import {
  AccountLayout,
  createBurnCheckedInstruction,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  type PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { COIN_DECIMALS } from "./launch.ts";
import {
  BN,
  buyQuoteInput,
  canonicalPumpPoolPdaWithQuote,
  type Global,
  type OnlinePumpAmmSdk,
  PUMP_AMM_SDK,
  PUMP_SDK,
} from "./pump.ts";
import { ataIx, buyExactIn, buyExactOut } from "./trade.ts";

type Amm = InstanceType<typeof OnlinePumpAmmSdk>;
type W = { ops: PublicKey; w: PublicKey; wFloatLamports: number };

const float = (o: W): TransactionInstruction[] =>
  o.wFloatLamports > 0
    ? [SystemProgram.transfer({ fromPubkey: o.ops, toPubkey: o.w, lamports: o.wFloatLamports })]
    : [];

const burnIx = (w: PublicKey, mint: PublicKey, amount: bigint) =>
  createBurnCheckedInstruction(
    getAssociatedTokenAddressSync(mint, w, true, T22),
    mint,
    w,
    amount,
    COIN_DECIMALS,
    [],
    T22,
  );

const big = (x: BN): bigint => BigInt(x.toString());

// W's child balance after the whole instruction list, from a simulation that returns that account. The
// limit is the max so the simulation never fails on CU before the real budget is known.
async function simulatedBalance(
  conn: Connection,
  payer: PublicKey,
  ixs: TransactionInstruction[],
  ata: PublicKey,
) {
  const limit = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [limit, ...ixs],
  });
  const sim = await conn.simulateTransaction(new VersionedTransaction(msg.compileToV0Message()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    accounts: { addresses: [ata.toBase58()], encoding: "base64" },
  });
  if (sim.value.err) throw new Error(`forced bond simulation failed: ${JSON.stringify(sim.value.err)}`);
  const acct = sim.value.accounts?.[0];
  if (!acct) throw new Error("simulation returned no account: the accounts option is unsupported here");
  return AccountLayout.decode(Buffer.from(acct.data[0], "base64")).amount;
}

// buy_exact_quote_in_v3 with the whole budget, then BurnChecked of the simulated out. Past the remaining
// supply the buy completes the curve and buys the rest from the pool-to-be, so simOut covers both legs.
// ponytail: a front-run between simulate and land either reverts the whole tx (burn above the balance) or
// leaves dust in W; Phase 5 picks this or exactBondIxs, which always burns exactly.
export async function forcedBondIxs(o: {
  conn: Connection;
  global: Global;
  ops: Keypair;
  w: Keypair;
  mint: PublicKey;
  quoteMint: PublicKey;
  budget: BN;
  wFloatLamports: number;
}): Promise<{ ixs: TransactionInstruction[]; burnAmount: BN }> {
  const side = { global: o.global, mint: o.mint, user: o.w.publicKey, quoteMint: o.quoteMint };
  const buy = await buyExactIn({ ...side, spend: o.budget, minOut: new BN(1) });
  const w = { ops: o.ops.publicKey, w: o.w.publicKey, wFloatLamports: o.wFloatLamports };
  const ixs = [...float(w), ...buy];
  const ata = getAssociatedTokenAddressSync(o.mint, o.w.publicKey, true, T22);
  const simOut = await simulatedBalance(o.conn, o.ops.publicKey, ixs, ata);
  return { ixs: [...ixs, burnIx(o.w.publicKey, o.mint, simOut)], burnAmount: new BN(simOut.toString()) };
}

// buy_v3 of exactly `amount` for at most maxQuote, then BurnChecked(amount) (D-16).
export async function exactBondIxs(
  o: W & { global: Global; mint: PublicKey; quoteMint: PublicKey; amount: BN; maxQuote: BN },
): Promise<TransactionInstruction[]> {
  const buy = await buyExactOut({ ...o, user: o.w });
  return [...float(o), ...buy, burnIx(o.w, o.mint, big(o.amount))];
}

// migrate_v2 is permissionless (D-03): any signer is `user`. The SDK appends the boost accounts.
export async function migrateIxs(o: {
  global: Global;
  user: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
}): Promise<TransactionInstruction[]> {
  const quoteTokenProgram = o.quoteMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : T22;
  const withdrawAuthority = o.global.withdrawAuthority;
  const args = { withdrawAuthority, mint: o.mint, user: o.user, quoteMint: o.quoteMint };
  return [await PUMP_SDK.migrateV2Instruction({ ...args, baseTokenProgram: T22, quoteTokenProgram })];
}

// The SDK picks a random listed buyback wallet and v2 never creates its quote ATA, so the first listed one
// is pinned and its ATA created idempotently by ops (Pitfall 5).
async function poolState(amm: Amm, ops: PublicKey, w: PublicKey, mint: PublicKey, quoteMint: PublicKey) {
  const s = await amm.swapSolanaState(canonicalPumpPoolPdaWithQuote(mint, quoteMint), w);
  const buyback = s.globalConfig.buybackFeeRecipients[0];
  if (!buyback) throw new Error("PumpSwap GlobalConfig has no buyback fee recipients");
  const state = { ...s, globalConfig: { ...s.globalConfig, buybackFeeRecipients: [buyback] } };
  return { state, buybackAta: ataIx(ops, quoteMint, buyback) };
}

// The base a quote buys on the pool, after fees: what the fallback burn sizes from.
export async function poolBaseOut(o: {
  amm: Amm;
  w: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  quote: BN;
}) {
  const s = await o.amm.swapSolanaState(canonicalPumpPoolPdaWithQuote(o.mint, o.quoteMint), o.w);
  return buyQuoteInput({
    quote: o.quote,
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

// PumpSwap buy_v2 of exactly baseOut, then BurnChecked(baseOut): the fallback after migration.
export async function poolBuyBurnIxs(
  o: W & { connAmm: Amm; mint: PublicKey; quoteMint: PublicKey; baseOut: BN; maxQuoteIn: BN },
): Promise<TransactionInstruction[]> {
  const { state, buybackAta } = await poolState(o.connAmm, o.ops, o.w, o.mint, o.quoteMint);
  const buy = await PUMP_AMM_SDK.buyV2Instructions(state, o.baseOut, o.maxQuoteIn);
  return [...float(o), buybackAta, ...buy, burnIx(o.w, o.mint, big(o.baseOut))];
}
