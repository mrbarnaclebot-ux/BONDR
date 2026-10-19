const [rpc, NM] = process.argv.slice(2);
const pump = require(`${NM}/@pump-fun/pump-sdk`);
const { Connection } = require(`${NM}/@solana/web3.js`);
(async () => {
  const o = new pump.OnlinePumpSdk(new Connection(rpc, "confirmed"));
  const g = await o.fetchGlobal();
  const qc = await o.fetchQuoteControl();
  console.log("whitelisted", g.whitelistedQuoteMints.map(String).filter((k) => k !== "11111111111111111111111111111111"));
  console.log("quoteControl", qc ? qc.mints.map((m) => m.mint.toBase58()) : null);
  console.log("supported", (await o.fetchSupportedQuoteMints()).map((m) => `${m.mint.toBase58()}:${m.source}`));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
