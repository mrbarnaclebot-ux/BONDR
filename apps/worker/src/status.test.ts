import { expect, test } from "vitest";
import { launchNet } from "./env.ts";
import { networkFee, pauseReason } from "./status.ts";

test("pauseReason: kill switch first, awaiting migration pauses, a migrated BONDR does not (D-18)", () => {
  expect(pauseReason({ enabled: false, venue: "curve" })).toBe("kill_switch");
  expect(pauseReason({ enabled: false, venue: "pool" })).toBe("kill_switch");
  expect(pauseReason({ enabled: true, venue: "awaiting" })).toBe("awaiting_migration");
  expect(pauseReason({ enabled: true, venue: "pool" })).toBe(null);
  expect(pauseReason({ enabled: true, venue: "curve" })).toBe(null);
  expect(pauseReason({ enabled: true, venue: null })).toBe(null);
});

test("launchNet allows devnet only and refuses mainnet in Phase 2 (D-02)", () => {
  expect(launchNet({ SOLANA_NET: "devnet" })).toBe("devnet");
  expect(() => launchNet({ SOLANA_NET: "mainnet" })).toThrow("ALLOW_MAINNET");
  expect(() => launchNet({ SOLANA_NET: "mainnet", ALLOW_MAINNET: "1" })).toThrow(
    "mainnet RPC is not wired until Phase 7",
  );
  expect(() => launchNet({})).toThrow();
  expect(() => launchNet({ SOLANA_NET: "fork" })).toThrow();
});

test("networkFee is two signatures plus the priority fee over the 600k CU limit", () => {
  expect(networkFee(1000)).toBe(10_600n);
  expect(networkFee(0)).toBe(10_000n);
});
