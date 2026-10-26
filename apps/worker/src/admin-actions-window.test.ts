// Sweep now refuses a coin whose current window already has a live sweep: the DB allows one sweep per window,
// so running it would collect and split and then skip the sweep (found on devnet, 06-review).
import { Keypair, PublicKey } from "@solana/web3.js";
import { expect, test } from "vitest";
import { ACTIONS, actionView } from "./admin-actions.ts";
import { memoryLedger } from "./fee-ledger-memory.ts";
import type { FeeCoin, FeeDeps } from "./fee-send.ts";

const DAY = 86_400_000;
const MINT = PublicKey.unique();

// The views use a pool coin, so actionView makes no cost read; windowSwept does not depend on the venue.
const coin = (venue: FeeCoin["venue"]): FeeCoin => ({
  ...{ mint: MINT, w: Keypair.generate(), launchedAt: Date.now() - 2.5 * DAY, venue, feesUnclaimed: 0n },
  ...{ feeBudget: 0n, cost: null, launchSig: "l", wallet: PublicKey.unique(), finalize: "none" },
});

const deps = () =>
  ({
    ...{ Q: PublicKey.unique(), buyback: Keypair.generate(), windowMs: DAY, ledger: memoryLedger() },
    conn: { getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(() => null) },
  }) as unknown as FeeDeps;

test("actionView marks the current window swept only when it holds a live sweep", async () => {
  const d = deps();
  const mint = MINT.toBase58();
  const view = () => actionView(d, mint, { coin: () => coin("pool") });
  await d.ledger.insertPending([{ kind: "sweep_buyback", mint, windowIndex: 1 }], "old", 1n);
  expect((await view()).windowSwept).toBe(false); // window 1 is past; the coin is in window 2
  await d.ledger.insertPending([{ kind: "sweep_treasury", mint, windowIndex: 2 }], "now", 1n);
  expect((await view()).windowSwept).toBe(true);
  expect((await actionView(d, null, null)).windowSwept).toBe(false);
});

test("sweep_now applies is window_swept with a swept current window and null otherwise", async () => {
  const v = await actionView(deps(), MINT.toBase58(), { coin: () => coin("pool") });
  const curve = { ...v, coin: coin("curve") };
  expect(ACTIONS.sweep_now.applies({ ...curve, windowSwept: true })).toBe("window_swept");
  expect(ACTIONS.sweep_now.applies({ ...curve, windowSwept: false })).toBeNull();
  expect(ACTIONS.sweep_now.applies({ ...v, windowSwept: true })).toBe("not_curve");
});
