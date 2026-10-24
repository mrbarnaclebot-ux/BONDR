// "Sold for" comes from the BONDR to SOL leg's event, never the wallet's SOL delta (S-CR-01).
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { expect, test } from "vitest";
import { lamportDelta, soldLamports } from "./trade.ts";

const f = JSON.parse(readFileSync(new URL("./fixtures/multihop-sell.json", import.meta.url), "utf8"));
const BONDR = new PublicKey("4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA");
const USER = new PublicKey("9Hm1YEfXqR2WD78rLHBM6nhnEB9tTURcwxtpU9TjwQM6");
const ATA_RENT = 2_039_280;

test("a sell that closes an ATA reports the leg's net, not the rent refund", () => {
  const tx = structuredClone(f.response);
  tx.meta.postBalances[0] += ATA_RENT; // the payer got a closed ATA's rent back in the same tx
  expect(lamportDelta(tx.meta)).toBe(9_754_865n + BigInt(ATA_RENT));
  // 9,848,426 quote - 93,561 fee - 0 creator fee
  expect(soldLamports(tx, BONDR, USER)).toBe(9_754_865n);
});

test("another user's or mint's sell is not read", () => {
  expect(soldLamports(f.response, BONDR, PublicKey.unique())).toBeUndefined();
  expect(soldLamports(f.response, PublicKey.unique(), USER)).toBeUndefined();
});
