// Live pump config as JSON-safe facts. Every value comes from chain (D-02): the spike records what the
// programs enforce today on this network, never what docs or PROJECT.md assume.
import type { Connection } from "@solana/web3.js";
import { GLOBAL_PDA, OnlinePumpAmmSdk, OnlinePumpSdk } from "./pump.ts";

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

export async function readLiveConfig(conn: Connection): Promise<Facts> {
  const online = new OnlinePumpSdk(conn);
  const [g, fc, afc, info] = await Promise.all([
    online.fetchGlobal(),
    online.fetchFeeConfig(),
    new OnlinePumpAmmSdk(conn).fetchFeeConfigAccount(),
    conn.getAccountInfo(GLOBAL_PDA),
  ]);
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
    globalBytes: info?.data.length ?? 0,
    ...fees("curveFlat", fc.flatFees, false),
    ...fees("curveExotic", fc.exoticFlatFees, false),
    ...fees("ammFlat", afc.flatFees, true),
    ...fees("ammExotic", afc.exoticFlatFees, true),
    ...fees("ammTier0", afc.feeTiers[0]?.fees, true),
  };
}
