// Live pump config as JSON-safe facts. Every value comes from chain (D-02): the spike records what the
// programs enforce today on this network, never what docs or PROJECT.md assume.
import type { AccountInfo, Connection } from "@solana/web3.js";
import { GLOBAL_PDA, PUMP_AMM_FEE_CONFIG_PDA, PUMP_AMM_SDK, PUMP_FEE_CONFIG_PDA, PUMP_SDK } from "./pump.ts";

type Facts = Record<string, string | number | boolean>;
type Bps = { toString(): string };
type Fees = { lpFeeBps: Bps; protocolFeeBps: Bps; creatorFeeBps: Bps };

// The bonding curve charges no LP fee, so curve schedules record only protocol and creator.
function fees(prefix: string, f: Fees | undefined, withLp: boolean): Facts {
  const out: Facts = {
    [`${prefix}.protocol`]: String(f?.protocolFeeBps ?? "none"),
    [`${prefix}.creator`]: String(f?.creatorFeeBps ?? "none"),
  };
  if (withLp) out[`${prefix}.lp`] = String(f?.lpFeeBps ?? "none");
  return out;
}

export const CONFIG_KEYS = [GLOBAL_PDA, PUMP_FEE_CONFIG_PDA, PUMP_AMM_FEE_CONFIG_PDA];
type Info = AccountInfo<Buffer> | null | undefined;

/** The facts from the three raw accounts (CONFIG_KEYS order). Throws when one is missing or does not decode with
 * the pinned SDK, the same decoders OnlinePumpSdk.fetchGlobal / fetchFeeConfig and fetchFeeConfigAccount use. */
export function configFacts([global, fee, ammFee]: Info[]): Facts {
  if (!global || !fee || !ammFee) throw new Error("a pump config account is missing");
  const g = PUMP_SDK.decodeGlobal(global);
  const fc = PUMP_SDK.decodeFeeConfig(fee);
  const afc = PUMP_AMM_SDK.decodeFeeConfig(ammFee);
  return {
    creatorFeeConfigurable: g.creatorFeeConfigurable,
    maxConfigurableCreatorFeeBps: g.maxConfigurableCreatorFeeBps.toString(),
    maxCurveDepth: g.maxCurveDepth,
    initialVirtualSolReserves: g.initialVirtualSolReserves.toString(),
    initialVirtualTokenReserves: g.initialVirtualTokenReserves.toString(),
    initialRealTokenReserves: g.initialRealTokenReserves.toString(),
    tokenTotalSupply: g.tokenTotalSupply.toString(),
    withdrawAuthority: g.withdrawAuthority.toBase58(),
    buybackFeeRecipient0: g.buybackFeeRecipients[0]?.toBase58() ?? "none",
    createV2Enabled: g.createV2Enabled,
    globalBytes: global.data.length,
    ...fees("curveFlat", fc.flatFees, false),
    ...fees("curveExotic", fc.exoticFlatFees, false),
    ...fees("ammFlat", afc.flatFees, true),
    ...fees("ammExotic", afc.exoticFlatFees, true),
    ...fees("ammTier0", afc.feeTiers[0]?.fees, true),
  };
}

// One RPC call; an RPC failure and a layout change both throw here (the contract check reads the raw accounts
// itself so it can tell them apart).
export async function readLiveConfig(conn: Connection): Promise<Facts> {
  return configFacts(await conn.getMultipleAccountsInfo(CONFIG_KEYS));
}
