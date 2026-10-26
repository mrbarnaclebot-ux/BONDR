import { BN, type Global } from "@bondr/core/pump";
import { PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { launchNet } from "./env.ts";
import { type Ctx, childFees, liveStatus, networkFee, parseSwitch, pauseReason } from "./status.ts";

// The switches live in memory; no database in this unit file.
vi.mock("./switches.ts", () => ({ switchesLoaded: () => true, switchOn: () => true }));

test("pauseReason: kill switch first, awaiting migration pauses, a migrated BONDR does not (D-18)", () => {
  expect(pauseReason({ enabled: false, venue: "curve" })).toBe("kill_switch");
  expect(pauseReason({ enabled: false, venue: "pool" })).toBe("kill_switch");
  expect(pauseReason({ enabled: true, venue: "awaiting" })).toBe("awaiting_migration");
  expect(pauseReason({ enabled: true, venue: "pool" })).toBe(null);
  expect(pauseReason({ enabled: true, venue: "curve" })).toBe(null);
  expect(pauseReason({ enabled: true, venue: null })).toBe(null);
});

test("launchNet allows devnet, and mainnet only with ALLOW_MAINNET=1 (D-01)", () => {
  expect(launchNet({ SOLANA_NET: "devnet" })).toBe("devnet");
  expect(() => launchNet({ SOLANA_NET: "mainnet" })).toThrow("ALLOW_MAINNET");
  expect(launchNet({ SOLANA_NET: "mainnet", ALLOW_MAINNET: "1" })).toBe("mainnet");
  expect(() => launchNet({})).toThrow();
  expect(() => launchNet({ SOLANA_NET: "fork" })).toThrow();
});

test("networkFee is two signatures plus the priority fee over the 600k CU limit", () => {
  expect(networkFee(1000)).toBe(10_600n);
  expect(networkFee(0)).toBe(10_000n);
});

test("the status fees use BONDR's 150 bps creator fee exactly where the build does (WR-07)", () => {
  const Q = PublicKey.unique();
  const g = (creatorFeeConfigurable: boolean) =>
    ({
      creatorFeeConfigurable,
      whitelistedQuoteMints: [Q],
      initialVirtualQuoteReserves: new BN(30_000_000_000),
      initialVirtualTokenReserves: new BN(1_073_000_000_000_000),
      initialRealTokenReserves: new BN(793_100_000_000_000),
      tokenTotalSupply: new BN(1_000_000_000_000_000),
      mayhemModeEnabled: false,
      feeBasisPoints: new BN(95),
      creatorFeeBasisPoints: new BN(30),
    }) as unknown as Global;
  const pq = { curve: { quoteControl: null } } as unknown as Parameters<typeof childFees>[3];
  expect(childFees(g(true), null, Q, pq).creatorFeeBps.toNumber()).toBe(150);
  expect(childFees(g(false), null, Q, pq).creatorFeeBps.toNumber()).toBe(30);
});

test("the kill switch route takes only a boolean", () => {
  expect(parseSwitch({ enabled: false })).toBe(false);
  expect(parseSwitch({ enabled: true })).toBe(true);
  for (const bad of [undefined, null, {}, { enabled: "false" }, { enabled: 0 }])
    expect(() => parseSwitch(bad)).toThrow("invalid_input");
});

test("/status reports the worker's own net (row 14) and the Sender tip on mainnet only (D-34)", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {}); // the stubbed chain read fails on purpose
  const down = async () => {
    throw new Error("no chain in this test");
  };
  const ctx = (net: Ctx["net"]) =>
    ({
      net,
      Q: PublicKey.unique(),
      priorityFee: 0,
      conn: { getAccountInfo: down },
      online: {},
    }) as unknown as Ctx;
  vi.useFakeTimers({ toFake: ["Date"] });
  expect(await liveStatus(ctx("mainnet"))).toMatchObject({ net: "mainnet", senderTipEstimate: "1000000" });
  vi.setSystemTime(Date.now() + 10_000); // past the 5 s status cache
  expect(await liveStatus(ctx("devnet"))).toMatchObject({ net: "devnet", senderTipEstimate: null });
  vi.useRealTimers();
});
