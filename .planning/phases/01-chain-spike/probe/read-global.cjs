// Read live pump Global / FeeConfig / AMM FeeConfig through a given RPC (fork or mainnet).
const NM = process.argv[3];
const rpc = process.argv[2];
const pump = require(`${NM}/@pump-fun/pump-sdk`);
const amm = require(`${NM}/@pump-fun/pump-swap-sdk`);
const { Connection } = require(`${NM}/@solana/web3.js`);
(async () => {
  const conn = new Connection(rpc, "confirmed");
  const online = new pump.OnlinePumpSdk(conn);
  const g = await online.fetchGlobal();
  const fc = await online.fetchFeeConfig();
  const info = await conn.getAccountInfo(pump.GLOBAL_PDA);
  const pick = (o, ks) => Object.fromEntries(ks.map((k) => [k, o[k]?.toString?.() ?? String(o[k])]));
  console.log("global bytes", info.data.length);
  console.log(
    pick(g, [
      "creatorFeeConfigurable",
      "maxConfigurableCreatorFeeBps",
      "maxCurveDepth",
      "initialVirtualTokenReserves",
      "initialVirtualSolReserves",
      "initialRealTokenReserves",
      "tokenTotalSupply",
      "poolMigrationFee",
      "createV2Enabled",
      "withdrawAuthority",
      "isHolderRewardEnabled",
    ]),
  );
  console.log("buybackFeeRecipients", g.buybackFeeRecipients?.map((p) => p.toBase58()));
  const fees = (f) => f && Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.toString()]));
  console.log("flatFees", fees(fc.flatFees));
  console.log("exoticFlatFees", fees(fc.exoticFlatFees));
  console.log("tier0", fc.feeTiers?.[0] && { t: fc.feeTiers[0].marketCapLamportsThreshold.toString(), ...fees(fc.feeTiers[0].fees) });
  console.log("tiers", fc.feeTiers?.length, "stableTiers", fc.stableFeeTiers?.length);
  console.log("feeConfig keys", Object.keys(fc));
  const afc = await new amm.OnlinePumpAmmSdk(conn).fetchFeeConfigAccount();
  console.log("amm keys", Object.keys(afc));
  console.log("amm flat", fees(afc.flatFees), "amm exotic", fees(afc.exoticFlatFees));
  console.log("amm tier0", afc.feeTiers?.[0] && fees(afc.feeTiers[0].fees));
  console.log("quote control", (await online.fetchQuoteControl()) ? "present" : "absent");
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
