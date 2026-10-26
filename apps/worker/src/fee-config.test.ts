// The per-net money numbers the go-live gates change (G-4 ops floor, G-6 launch tip, G-10 pace): one table.
import { expect, test } from "vitest";
import { feeConfig } from "./fee-config.ts";

test("mainnet: 0.1 SOL ops floor, 0.001 SOL tips, pace 1100 until G-10, 150 bps", () => {
  expect(feeConfig("mainnet")).toMatchObject({
    ...{ paceMs: 1100, opsFloorLamports: 100_000_000, launchTipLamports: 1_000_000 },
    ...{ senderTipLamports: 1_000_000, collectMinLamports: 1_000_000, creatorFeeBps: 150 },
  });
});

test("devnet: 0.05 SOL ops floor, pace 1100, the launch tip is unused off mainnet", () => {
  expect(feeConfig("devnet")).toMatchObject({
    ...{ paceMs: 1100, opsFloorLamports: 50_000_000, launchTipLamports: 1_000_000 },
    ...{ collectMinLamports: 10_000, creatorFeeBps: 0 },
  });
});
