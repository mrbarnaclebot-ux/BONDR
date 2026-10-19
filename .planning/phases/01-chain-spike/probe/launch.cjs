// Research probe on a local Surfpool fork: stand-in Q (SOL pair), then a child create_v2 (quote Q, 150 bps)
// + dev buy + insta burn / insta sell in ONE v0 tx with a fork ALT. Records bytes and CU. Fork only.
const [RPC, NM] = process.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:/.test(RPC)) throw new Error("fork only");
const pump = require(`${NM}/@pump-fun/pump-sdk`);
const spl = require(`${NM}/@solana/spl-token`);
const w3 = require(`${NM}/@solana/web3.js`);
const BN = require(`${NM}/bn.js`);
const { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, AddressLookupTableProgram } = w3;
const T22 = spl.TOKEN_2022_PROGRAM_ID;
const conn = new Connection(RPC, "confirmed");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ata = (mint, owner, prog = T22) => spl.getAssociatedTokenAddressSync(mint, owner, true, prog);
const createAta = (payer, mint, owner, prog = T22) =>
  spl.createAssociatedTokenAccountIdempotentInstruction(payer, ata(mint, owner, prog), owner, mint, prog);
const out = [];

async function send(label, payer, ixs, signers = [], luts = []) {
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
  const tx = new VersionedTransaction(msg);
  tx.sign([payer, ...signers]);
  const wire = tx.serialize();
  const r = { label, bytes: wire.length };
  try {
    const sig = await conn.sendRawTransaction(wire, { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    const got = await conn.getTransaction(sig, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    Object.assign(r, { ok: !got.meta.err, sig: sig.slice(0, 8), cu: got.meta.computeUnitsConsumed, err: got.meta.err });
  } catch (e) {
    const logs = e.logs ?? e.transactionLogs ?? [];
    Object.assign(r, { ok: false, err: String(e.message).slice(0, 300), lastLogs: logs.slice(-6) });
  }
  out.push(r);
  console.log(JSON.stringify(r));
  return r.ok;
}

(async () => {
  const online = new pump.OnlinePumpSdk(conn);
  const dev = Keypair.generate();
  await conn.confirmTransaction(await conn.requestAirdrop(dev.publicKey, 200e9), "confirmed");
  const global = await online.fetchGlobal();
  const feeConfig = await online.fetchFeeConfig();
  const cb = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })];
  // 1. Stand-in Q: SOL-paired create_v2, then a 5 SOL buy so Q has some price.
  const qKp = Keypair.generate();
  const Q = qKp.publicKey;
  await send("prefund Q mint (fork rent)", dev, [SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: Q, lamports: 5_000_000 })]);
  await send("create stand-in Q", dev, [...cb, await pump.PUMP_SDK.createV2Instruction({ mint: Q, name: "Stand In", symbol: "STAND", uri: "ipfs://x", creator: dev.publicKey, user: dev.publicKey, mayhemMode: false })], [qKp]);
  const qs = await online.fetchBuyState(Q, dev.publicKey, T22);
  await send("buy Q 5 SOL (buy_exact_quote_in_v3)", dev, [...cb, ...(await pump.PUMP_SDK.buyExactQuoteInV3Instructions({ bondingCurve: qs.bondingCurve, associatedUserAccountInfo: qs.associatedUserAccountInfo, mint: Q, user: dev.publicKey, amount: new BN(1), quoteAmount: new BN(5e9), slippage: 1, tokenProgram: T22 }))]);

  // 2. Child launch: one tx per exit, built from a fresh Q read.
  const resolved = await online.resolveQuoteMint(Q);
  console.log(JSON.stringify({ source: resolved.source, qTokenProgram: resolved.quoteTokenProgram.toBase58(), initialVirtualQuoteReserves: resolved.initialVirtualQuoteReserves.toString(), depth: resolved.pumpQuote.depth }));
  const W = Keypair.generate().publicKey;
  const buybackWallet = global.buybackFeeRecipients[0];
  async function launch(exit) {
    const mintKp = Keypair.generate();
    const mint = mintKp.publicKey;
    await send(`prefund child mint (${exit})`, dev, [SystemProgram.transfer({ fromPubkey: dev.publicKey, toPubkey: mint, lamports: 5_000_000 })]);
    const pq = await online.fetchPumpQuote(Q, { global });
    const qState = await online.fetchBuyState(Q, dev.publicKey, T22);
    const solIn = new BN(250_000_000);
    const qOut = pump.getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: qState.bondingCurve.tokenTotalSupply, bondingCurve: qState.bondingCurve, amount: solIn, curveBaseTokenBalance: qState.curveBaseTokenBalance });
    const qMin = qOut.muln(99).divn(100);
    const child = pump.newBondingCurve(global, Q, pq.curve.quoteControl, new BN(150), false, pq.curve);
    const childOut = pump.getBuyV3TokenAmountFromQuoteAmount({ global, feeConfig, mintSupply: global.tokenTotalSupply, bondingCurve: child, amount: qMin, curveBaseTokenBalance: global.tokenTotalSupply });
    const amount = childOut.muln(98).divn(100); // exact tokens out; max cost = qMin
    const ixs = [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
      ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      await pump.PUMP_SDK.createV2Instruction({ mint, name: "Child Coin", symbol: "CHILD", uri: "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy", creator: W, user: dev.publicKey, mayhemMode: false, quoteMint: Q, quoteTokenProgram: T22, creatorFeeBps: new BN(150), pumpQuote: pq.accounts }),
      createAta(dev.publicKey, Q, dev.publicKey),
      await pump.PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({ user: dev.publicKey, mint: Q, spendableQuoteIn: solIn, minTokensOut: qMin, tokenProgram: T22, quoteMint: spl.NATIVE_MINT, quoteTokenProgram: spl.TOKEN_PROGRAM_ID, buybackFeeRecipient: buybackWallet }),
      createAta(dev.publicKey, mint, dev.publicKey),
      createAta(dev.publicKey, Q, buybackWallet),
      await pump.PUMP_SDK.getBuyV3InstructionRaw({ user: dev.publicKey, mint, amount, quoteAmount: qMin, tokenProgram: T22, quoteMint: Q, quoteTokenProgram: T22, buybackFeeRecipient: buybackWallet }),
      exit === "burn"
        ? spl.createBurnCheckedInstruction(ata(mint, dev.publicKey), mint, dev.publicKey, BigInt(amount.toString()), 6, [], T22)
        : await pump.PUMP_SDK.getSellV3InstructionRaw({ user: dev.publicKey, mint, amount, quoteAmount: new BN(1), tokenProgram: T22, quoteMint: Q, quoteTokenProgram: T22, buybackFeeRecipient: buybackWallet }),
    ];
    const programs = new Set(ixs.map((i) => i.programId.toBase58()));
    const perLaunch = new Set([mint, dev.publicKey, pump.bondingCurvePda(mint), ata(mint, dev.publicKey), ata(Q, dev.publicKey)].map((k) => k.toBase58()));
    const shared = [...new Set(ixs.flatMap((i) => i.keys.filter((k) => !k.isSigner).map((k) => k.pubkey.toBase58())))].filter((k) => !programs.has(k));
    const [create, lutKey] = AddressLookupTableProgram.createLookupTable({ authority: dev.publicKey, payer: dev.publicKey, recentSlot: await conn.getSlot("finalized") });
    await send(`ALT (${exit}, ${shared.length} keys)`, dev, [create, AddressLookupTableProgram.extendLookupTable({ payer: dev.publicKey, authority: dev.publicKey, lookupTable: lutKey, addresses: shared.map((k) => new PublicKey(k)) })]);
    await sleep(2000);
    const lut = (await conn.getAddressLookupTable(lutKey)).value;
    const ok = await send(`LAUNCH create+buy+${exit} (ALT, ${shared.length} keys incl per-mint)`, dev, ixs, [mintKp], [lut]);
    if (ok) {
      const bal = await conn.getTokenAccountBalance(ata(mint, dev.publicKey)).catch(() => null);
      const supply = await conn.getTokenSupply(mint);
      const qBal = await conn.getTokenAccountBalance(ata(Q, dev.publicKey));
      console.log(JSON.stringify({ exit, devChildBalanceAfter: bal?.value.amount, childSupply: supply.value.amount, devQLeft: qBal.value.amount, perLaunchKeysNotNeededInAlt: [...perLaunch].length }));
    }
  }
  await launch("burn");
  await launch("sell");
})().catch((e) => { console.error("ERR", e.stack?.slice(0, 800)); process.exit(1); });
