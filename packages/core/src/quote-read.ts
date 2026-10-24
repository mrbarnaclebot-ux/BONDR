// The chain reads behind a route quote: one multi-account read for the four fee configs, one per mint for
// its curve or pool, and hopInputs, the one builder of quote.ts HopInputs (the worker and the fork rows share
// it). Worker-side: it loads pump.ts, so web must never import it (D-08).
import {
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID as T22,
  TOKEN_PROGRAM_ID,
  unpackAccount,
  unpackMint,
} from "@solana/spl-token";
import type { AccountInfo, Connection, PublicKey } from "@solana/web3.js";
import { AwaitingMigration } from "./launch.ts";
import {
  type AmmFeeConfig,
  BN,
  type BondingCurve,
  bondingCurvePda,
  canonicalPumpPoolPdaWithQuote,
  type FeeConfig,
  GLOBAL_CONFIG_PDA,
  GLOBAL_PDA,
  type Global,
  type GlobalConfig,
  normalizeQuoteMint,
  type Pool,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_AMM_SDK,
  PUMP_FEE_CONFIG_PDA,
  PUMP_PROGRAM_ID,
  PUMP_SDK,
} from "./pump.ts";
import { curveRates, type HopInput } from "./quote.ts";

export type Configs = {
  global: Global;
  feeConfig: FeeConfig;
  ammGlobalConfig: GlobalConfig;
  ammFeeConfig: AmmFeeConfig | null; // the SDK treats a missing AMM FeeConfig as flat GlobalConfig rates
};
type Base = { mint: PublicKey; supply: BN; tokenPrograms: HopInput["tokenPrograms"] };
export type MintState = Base &
  (
    | { venue: "curve"; curve: BondingCurve; curveTokenBalance: BN }
    | { venue: "pool"; pool: Pool; poolKey: PublicKey; poolBaseAmount: BN; poolQuoteAmount: BN }
    | { venue: "awaiting" } // complete, pool not created yet (the 6107 window)
  );

const need = (info: AccountInfo<Buffer> | null, what: string): AccountInfo<Buffer> => {
  if (!info) throw new Error(`${what} account not found`);
  return info;
};

export async function readConfigs(conn: Connection): Promise<Configs> {
  const [g, fc, ag, af] = await conn.getMultipleAccountsInfo([
    GLOBAL_PDA,
    PUMP_FEE_CONFIG_PDA,
    GLOBAL_CONFIG_PDA,
    PUMP_AMM_FEE_CONFIG_PDA,
  ]);
  return {
    global: PUMP_SDK.decodeGlobal(need(g, "pump Global")),
    feeConfig: PUMP_SDK.decodeFeeConfig(need(fc, "pump FeeConfig")),
    ammGlobalConfig: PUMP_AMM_SDK.decodeGlobalConfig(need(ag, "AMM GlobalConfig")),
    ammFeeConfig: af ? PUMP_AMM_SDK.decodeFeeConfig(af) : null,
  };
}

const balance = (key: PublicKey, info: AccountInfo<Buffer> | null, program: PublicKey): BN =>
  new BN(unpackAccount(key, need(info, "vault"), program).amount.toString());

/** A mint's venue and state in one read. Every BONDR coin and BONDR itself is a Token-2022 mint. */
export async function readMintState(
  conn: Connection,
  mint: PublicKey,
  quoteMint: PublicKey,
): Promise<MintState> {
  const quoteProgram = quoteMint.equals(NATIVE_MINT) ? TOKEN_PROGRAM_ID : T22;
  const curveKey = bondingCurvePda(mint);
  const poolKey = canonicalPumpPoolPdaWithQuote(mint, quoteMint);
  // The pool's vaults are its ATAs, as pump-sdk's multi-hop accounts derive them.
  const keys = [
    mint,
    curveKey,
    getAssociatedTokenAddressSync(mint, curveKey, true, T22),
    poolKey,
    getAssociatedTokenAddressSync(mint, poolKey, true, T22),
    getAssociatedTokenAddressSync(quoteMint, poolKey, true, quoteProgram),
  ];
  const infos = await conn.getMultipleAccountsInfo(keys);
  const [m, c, ca, p, pb, pq] = infos;
  const base: Base = {
    mint,
    supply: new BN(unpackMint(mint, need(m, "mint"), T22).supply.toString()),
    tokenPrograms: { base: T22, quote: quoteProgram },
  };
  // The venue rule of OnlinePumpSdk.resolveMultiHopRoute: a tradable curve first, then the canonical pool.
  const curve = c?.owner.equals(PUMP_PROGRAM_ID) ? PUMP_SDK.decodeBondingCurve(c) : null;
  if (curve && !curve.complete && normalizeQuoteMint(curve.quoteMint).equals(quoteMint))
    return { ...base, venue: "curve", curve, curveTokenBalance: balance(keys[2], ca, T22) };
  if (!p?.owner.equals(PUMP_AMM_PROGRAM_ID)) return { ...base, venue: "awaiting" };
  const pool = PUMP_AMM_SDK.decodePool(p);
  if (!pool.poolBaseTokenAccount.equals(keys[4]) || !pool.poolQuoteTokenAccount.equals(keys[5]))
    throw new Error(`pool ${poolKey.toBase58()} vaults are not its ATAs`);
  return {
    ...base,
    venue: "pool",
    pool,
    poolKey,
    poolBaseAmount: balance(keys[4], pb, T22),
    poolQuoteAmount: balance(keys[5], pq, quoteProgram),
  };
}

const big = (b: BN): bigint => BigInt(b.toString());

/** The quote.ts hop for a mint state; an awaiting state throws AwaitingMigration, which callers map to paused. */
export function hopInputs(s: MintState, c: Configs): HopInput {
  if (s.venue === "awaiting") throw new AwaitingMigration(s.mint);
  if (s.venue === "pool") {
    const { pool, poolKey, poolBaseAmount, poolQuoteAmount } = s;
    return {
      kind: "pool",
      pool,
      poolKey,
      poolBaseAmount,
      poolQuoteAmount,
      baseMintSupply: s.supply,
      tokenPrograms: s.tokenPrograms,
    };
  }
  const state = {
    vQ: big(s.curve.virtualQuoteReserves),
    vT: big(s.curve.virtualTokenReserves),
    realTokens: big(s.curve.realTokenReserves),
    ...curveRates(c.global, c.feeConfig, s.curve),
  };
  return { kind: "curve", state, tokenPrograms: s.tokenPrograms };
}
