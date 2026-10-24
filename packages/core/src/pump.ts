// The only load point of the pump.fun SDKs (D-08). The pump-sdk ESM build crashes under plain Node 24
// ("Named export 'BN' not found": @coral-xyz/anchor is CommonJS), so both SDKs load through createRequire.
// Use bn.js for amounts, never anchor's BN. Web code must never import this file (D-08): it is chain-side only.
// pump-swap-sdk resolves to 2.1.0 here, never the transitive 1.20.0 copy nested under pump-sdk.
import { createRequire } from "node:module";
import BN from "bn.js";

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk") as typeof import("@pump-fun/pump-sdk");
const amm = require("@pump-fun/pump-swap-sdk") as typeof import("@pump-fun/pump-swap-sdk");

export const {
  PUMP_SDK,
  OnlinePumpSdk,
  GLOBAL_PDA,
  bondingCurvePda,
  feeSharingConfigPda,
  creatorVaultPda,
  canonicalPumpPoolPdaWithQuote,
  newBondingCurve,
  computeFeesBps,
  getBuyV3TokenAmountFromQuoteAmount,
  getBuyV3QuoteAmountFromTokenAmount,
  getSellSolAmountFromTokenAmount,
  getPumpFeeProgram,
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  PUMP_FEE_CONFIG_PDA,
  PUMP_EVENT_AUTHORITY_PDA,
  normalizeQuoteMint,
  pumpIdl,
} = pump;
export const {
  PUMP_AMM_SDK,
  OnlinePumpAmmSdk,
  buyQuoteInput,
  pumpAmmJson,
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  multiHopSwapQuote,
  resolveMultiHopRoute,
  pumpPoolAuthorityPda,
  GLOBAL_CONFIG_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
} = amm;
export const computeAmmFeesBps = amm.computeFeesBps; // pool fees (lp, protocol, creator); same name as pump's
export type { BondingCurve, FeeConfig, Global, PumpQuoteAccounts } from "@pump-fun/pump-sdk"; // types only, erased at runtime
export type {
  FeeConfig as AmmFeeConfig,
  GlobalConfig,
  MultiHopLegFees,
  MultiHopQuoteHop,
  Pool,
} from "@pump-fun/pump-swap-sdk";
export { BN }; // SDK amount arguments (bn.js 5.2.5, never anchor's BN)
