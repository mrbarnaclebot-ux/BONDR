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
  type PublicKey,
  SystemProgram,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { COIN_DECIMALS } from "./launch.ts";
import { BN, buyQuoteInput, type Global, type OnlinePumpAmmSdk, PUMP_AMM_SDK, PUMP_SDK } from "./pump.ts";
import { ataIx, buyExactIn, buyExactOut, poolState } from "./trade.ts";

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

// buy_exact_quote_in_v3 with the whole budget, then BurnChecked of the simulated out: the production bond,
// since the owner chose to burn the full budget (PROJECT.md item 5). Past the remaining supply the buy
// completes the curve and buys the rest from the pool-to-be, so simOut covers both legs. The real buy floors
// at simOut, so a front-run buy between simulate and land reverts the tx as slippage instead of burning
// more than W holds; the caller re-simulates. A front-run sell gives W more than simOut, and the remainder
// stays in W for the worker to burn (Phase 5).
export async function forcedBondIxs(
  o: W & { conn: Connection; global: Global; mint: PublicKey; quoteMint: PublicKey; budget: BN },
): Promise<{ ixs: TransactionInstruction[]; burnAmount: BN }> {
  const side = { global: o.global, mint: o.mint, user: o.w, quoteMint: o.quoteMint };
  const buy = (minOut: BN) => buyExactIn({ ...side, spend: o.budget, minOut });
  const ata = getAssociatedTokenAddressSync(o.mint, o.w, true, T22);
  const simOut = await simulatedBalance(o.conn, o.ops, [...float(o), ...(await buy(new BN(1)))], ata);
  const burnAmount = new BN(simOut.toString());
  const ixs = [...float(o), ...(await buy(burnAmount)), burnIx(o.w, o.mint, simOut)];
  return { ixs, burnAmount };
}

// buy_v3 of exactly `amount` for at most maxQuote, then BurnChecked(amount) (D-16).
// ponytail: evidence-only since the full-budget decision; delete in Phase 2 or 5 if nothing calls it.
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

// The base a quote buys on the pool, after fees: what the fallback burn sizes from.
export async function poolBaseOut(o: {
  amm: Amm;
  w: PublicKey;
  mint: PublicKey;
  quoteMint: PublicKey;
  quote: BN;
}) {
  const { state: s } = await poolState({ amm: o.amm, mint: o.mint, quoteMint: o.quoteMint, user: o.w });
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
  const { state, buyback } = await poolState({
    amm: o.connAmm,
    mint: o.mint,
    quoteMint: o.quoteMint,
    user: o.w,
  });
  const buy = await PUMP_AMM_SDK.buyV2Instructions(state, o.baseOut, o.maxQuoteIn);
  return [...float(o), ataIx(o.ops, o.quoteMint, buyback), ...buy, burnIx(o.w, o.mint, big(o.baseOut))];
}
