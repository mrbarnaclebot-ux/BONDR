// Offline size estimate of BONDR launch transactions built with the real pump-sdk 4.1.0 builders.
const NM = process.argv[2];
const pump = require(`${NM}/@pump-fun/pump-sdk`);
const spl = require(`${NM}/@solana/spl-token`);
const w3 = require(`${NM}/@solana/web3.js`);
const BN = require(`${NM}/bn.js`);
const { Keypair, PublicKey, ComputeBudgetProgram, TransactionMessage, VersionedTransaction, AddressLookupTableAccount } = w3;
const T22 = spl.TOKEN_2022_PROGRAM_ID;
const ata = (mint, owner, prog = T22) => spl.getAssociatedTokenAddressSync(mint, owner, true, prog);
const createAta = (payer, mint, owner, prog = T22) =>
  spl.createAssociatedTokenAccountIdempotentInstruction(payer, ata(mint, owner, prog), owner, mint, prog);

const Q = Keypair.generate().publicKey; // stand-in quote coin (SOL-paired pump coin)
const fakePool = { pool: Keypair.generate().publicKey, baseVault: Keypair.generate().publicKey, quoteVault: Keypair.generate().publicKey };
async function build() {
  const dev = Keypair.generate();
  const mint = Keypair.generate();
  const W = Keypair.generate().publicKey;
  const buyback = new PublicKey("5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD");
  const name = "A".repeat(32);
  const symbol = "ABCDEFGHIJ";
  const uri = process.env.URI ?? "https://gateway.pinata.cloud/ipfs/bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy";
  const budget = [
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }),
  ];
  const create = (pool) =>
    pump.PUMP_SDK.createV2Instruction({
      mint: mint.publicKey, name, symbol, uri, creator: W, user: dev.publicKey, mayhemMode: false,
      quoteMint: Q, quoteTokenProgram: T22, creatorFeeBps: new BN(150), pumpQuote: { pool, chain: [] },
    });
  const buyQ = await pump.PUMP_SDK.getBuyExactQuoteInV3InstructionRaw({
    user: dev.publicKey, mint: Q, spendableQuoteIn: new BN(250000000), minTokensOut: new BN(1),
    tokenProgram: T22, quoteMint: spl.NATIVE_MINT, quoteTokenProgram: spl.TOKEN_PROGRAM_ID,
  });
  const buyChild = await pump.PUMP_SDK.getBuyV3InstructionRaw({
    user: dev.publicKey, mint: mint.publicKey, amount: new BN(1000), quoteAmount: new BN(1000),
    tokenProgram: T22, quoteMint: Q, quoteTokenProgram: T22,
  });
  const burn = spl.createBurnCheckedInstruction(ata(mint.publicKey, dev.publicKey), mint.publicKey, dev.publicKey, 1000n, 6, [], T22);
  const hopsBuy = [
    { venue: "curve", baseMint: Q, quoteMint: spl.NATIVE_MINT, baseTokenProgram: T22, quoteTokenProgram: spl.TOKEN_PROGRAM_ID },
    { venue: "curve", baseMint: mint.publicKey, quoteMint: Q, baseTokenProgram: T22, quoteTokenProgram: T22 },
  ];
  const hopsSell = [...hopsBuy].reverse();
  const mhBuy = await pump.PUMP_SDK.multiHopSwapInstructions({ user: dev.publicKey, hops: hopsBuy, side: "buy", amountIn: new BN(250000000), minAmountOut: new BN(1) });
  const mhSell = await pump.PUMP_SDK.multiHopSwapInstructions({ user: dev.publicKey, hops: hopsSell, side: "sell", amountIn: new BN(1000), minAmountOut: new BN(1) });
  const exactOutBuy = [createAta(dev.publicKey, Q, dev.publicKey), buyQ, createAta(dev.publicKey, mint.publicKey, dev.publicKey), createAta(dev.publicKey, Q, buyback), buyChild];
  const sellChild = await pump.PUMP_SDK.getSellV3InstructionRaw({
    user: dev.publicKey, mint: mint.publicKey, amount: new BN(1000), quoteAmount: new BN(1),
    tokenProgram: T22, quoteMint: Q, quoteTokenProgram: T22,
  });
  const variants = {
    "E exact-out buy + sell_v3 child to Q only (dev keeps Q)": [...budget, await create(undefined), ...exactOutBuy, sellChild],
    "A exact-out buy + burn (Q on curve)": [...budget, await create(undefined), ...exactOutBuy, burn],
    "B exact-out buy + multi_hop sell (Q on curve)": [...budget, await create(undefined), ...exactOutBuy, ...mhSell],
    "C multi_hop buy + burn (Q on curve)": [...budget, await create(undefined), ...mhBuy, burn],
    "D multi_hop buy + multi_hop sell (Q on curve)": [...budget, await create(undefined), ...mhBuy, ...mhSell],
    "A' exact-out buy + burn (Q migrated, +3 pool accts)": [...budget, await create(fakePool), ...exactOutBuy, burn],
  };
  return { dev, variants };
}
const keySet = (ixs) => {
  const programs = new Set(ixs.map((i) => i.programId.toBase58()));
  return [...new Set(ixs.flatMap((i) => i.keys.filter((k) => !k.isSigner).map((k) => k.pubkey.toBase58())))].filter((k) => !programs.has(k));
};
(async () => {
  const { dev, variants } = await build();
  const other = (await build()).variants;
  for (const [label, ixs] of Object.entries(variants)) {
    const otherKeys = new Set(keySet(other[label]));
    const keys = keySet(ixs).filter((k) => otherKeys.has(k)); // shared ALT: keys common to every launch
    const lut = new AddressLookupTableAccount({
      key: Keypair.generate().publicKey,
      state: { deactivationSlot: 2n ** 64n - 1n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses: keys.map((k) => new PublicKey(k)) },
    });
    const bh = Keypair.generate().publicKey.toBase58();
    const size = (luts) => {
      const msg = new TransactionMessage({ payerKey: dev.publicKey, recentBlockhash: bh, instructions: ixs }).compileToV0Message(luts);
      const tx = new VersionedTransaction(msg);
      try { return { bytes: tx.serialize().length, staticKeys: msg.staticAccountKeys.length }; } catch (e) {
        const cl = (n) => (n < 128 ? 1 : n < 16384 ? 2 : 3);
        let m = 1 + 3 + cl(msg.staticAccountKeys.length) + 32 * msg.staticAccountKeys.length + 32 + cl(msg.compiledInstructions.length);
        for (const ci of msg.compiledInstructions) m += 1 + cl(ci.accountKeyIndexes.length) + ci.accountKeyIndexes.length + cl(ci.data.length) + ci.data.length;
        m += cl(msg.addressTableLookups.length);
        for (const l of msg.addressTableLookups) m += 32 + cl(l.writableIndexes.length) + l.writableIndexes.length + cl(l.readonlyIndexes.length) + l.readonlyIndexes.length;
        const raw = m + 1 + 64 * msg.header.numRequiredSignatures;
        return { bytes: `${raw} (too large)`, staticKeys: msg.staticAccountKeys.length };
      }
    };
    console.log(JSON.stringify({ label, ixs: ixs.length, sharedAltKeys: keys.length, noLut: size([]), withLut: size([lut]) }));
  }
})().catch((e) => { console.error("ERR", e.stack); process.exit(1); });
