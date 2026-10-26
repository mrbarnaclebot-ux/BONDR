import { BN, type Global } from "@bondr/core/pump";
import { PublicKey } from "@solana/web3.js";
import { expect, test, vi } from "vitest";
import { launchNet } from "./env.ts";
import {
  type Ctx,
  childFees,
  liveStatus,
  networkFee,
  parseSwitch,
  pauseReason,
  type StatusCtx,
} from "./status.ts";

// The switches live in memory; no database in this unit file.
vi.mock("./switches.ts", () => ({ switchesLoaded: () => true, switchOn: () => true }));

test("pauseReason: kill switch first, awaiting migration pauses, a migrated BONDR does not (D-18)", () => {
  const no = { contract: false, genesis: false };
  expect(pauseReason({ enabled: false, venue: "curve", ...no })).toBe("kill_switch");
  expect(pauseReason({ enabled: false, venue: "pool", ...no })).toBe("kill_switch");
  expect(pauseReason({ enabled: false, venue: "awaiting", ...no })).toBe("kill_switch");
  expect(pauseReason({ enabled: true, venue: "awaiting", ...no })).toBe("awaiting_migration");
  expect(pauseReason({ enabled: true, venue: "pool", ...no })).toBe(null);
  expect(pauseReason({ enabled: true, venue: "curve", ...no })).toBe(null);
  expect(pauseReason({ enabled: true, venue: null, ...no })).toBe(null);
});

test("pauseReason: a failed contract check names itself ahead of every other reason (D-22)", () => {
  const c = { contract: true, genesis: false };
  expect(pauseReason({ enabled: false, venue: "curve", ...c })).toBe("contract_check");
  expect(pauseReason({ enabled: true, venue: "awaiting", ...c })).toBe("contract_check");
  expect(pauseReason({ enabled: true, venue: "pool", ...c })).toBe("contract_check");
});

test("pauseReason: genesis mode comes before every other reason (UI-SPEC surface 1)", () => {
  expect(pauseReason({ genesis: true, contract: true, enabled: false, venue: null })).toBe("genesis");
  expect(pauseReason({ genesis: true, contract: false, enabled: true, venue: "awaiting" })).toBe("genesis");
  expect(pauseReason({ genesis: true, contract: false, enabled: true, venue: null })).toBe("genesis");
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

test("/status in genesis mode: SOL-pair fees and minimum from the live Global, no quote, no legs (D-29)", async () => {
  const fetchPumpQuote = vi.fn(async () => {
    throw new Error("genesis must not read a quote mint");
  });
  const g = {
    creatorFeeConfigurable: false,
    whitelistedQuoteMints: [],
    initialVirtualSolReserves: new BN(30_000_000_000),
    initialVirtualTokenReserves: new BN(1_073_000_000_000_000),
    initialRealTokenReserves: new BN(793_100_000_000_000),
    tokenTotalSupply: new BN(1_000_000_000_000_000),
    mayhemModeEnabled: false,
  } as unknown as Global;
  const fees = { lpFeeBps: new BN(0), protocolFeeBps: new BN(93), creatorFeeBps: new BN(30) };
  const feeConfig = { feeTiers: [{ marketCapLamportsThreshold: new BN(0), fees }] };
  const treasury = PublicKey.unique();
  const ctx: StatusCtx = {
    ...{ net: "mainnet", Q: null, treasury, priorityFee: 0 },
    conn: { getMinimumBalanceForRentExemption: async (n: number) => n * 10 } as unknown as Ctx["conn"],
    online: {
      fetchGlobal: async () => g,
      fetchFeeConfig: async () => feeConfig,
      fetchPumpQuote,
    } as unknown as Ctx["online"],
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 60_000); // past the status earlier tests cached; last in the file, so its own entry leaks nowhere
  const s = await liveStatus(ctx);
  vi.useRealTimers();
  expect(s).toMatchObject({ paused: "genesis", quoteMint: null, genesisTreasury: treasury.toBase58() });
  expect(s.fees).toEqual({ protocolBps: 93, creatorBps: 30 });
  expect(s.minLamports).not.toBe(null);
  expect(s.createCostEstimate).not.toBe(null);
  expect(fetchPumpQuote).not.toHaveBeenCalled();
});
