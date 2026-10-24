import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { completeEvents, type EventTx, innerEvents } from "./events.ts";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = (name: string): EventTx => load(name).response;

test("innerEvents decodes the mainnet launch's CreateEvent and TradeEvent from emit_cpi", () => {
  const events = innerEvents(fixture("launch-20261008.json"));
  const names = events.map((e) => e.name);
  expect(names).toContain("CreateEvent");
  expect(names).toContain("TradeEvent");
  expect(names.some((n) => n.startsWith("unknown"))).toBe(false);
  const trade = events.find((e) => e.name === "TradeEvent")?.data;
  expect(trade?.mint).toBe("EhLyndhdN7K1VQokfGifFeedMztb73k57WS7Xq9mxsad");
  expect(trade?.isBuy).toBe(true);
});

test("an event under another account 0 is ignored", () => {
  const tx = fixture("launch-20261008.json");
  for (const g of tx.meta?.innerInstructions ?? []) for (const ix of g.instructions) ix.accounts[0] = 0;
  expect(innerEvents(tx)).toEqual([]);
});

test("a failed tx yields no events", () => {
  const tx = fixture("forced-bond.json");
  if (tx.meta) tx.meta.err = { InstructionError: [3, { Custom: 6003 }] };
  expect(innerEvents(tx)).toEqual([]);
});

// The fork forced bond (01-07): one tx completes C2 and burns; its mint is the run's state "C2".
test("completeEvents finds exactly one CompleteEvent for the forced-bonded child", () => {
  const { mint } = load("forced-bond.json");
  const events = completeEvents(fixture("forced-bond.json"));
  expect(events).toHaveLength(1);
  expect(events[0]?.mint).toBe(mint);
  expect(completeEvents(fixture("launch-20261008.json"))).toEqual([]);
});

// 03-02: every event carries its program and a running index (the trades (signature, ix) key).
const childTrades = (name: string) => {
  const { mint } = load(name);
  return innerEvents(fixture(name)).filter((e) => e.name === "TradeEvent" && e.data.mint === mint);
};

test("curve-buy: one child buy paid in BONDR, with ix and program pump", () => {
  const [t, ...rest] = childTrades("curve-buy.json");
  expect(rest).toEqual([]);
  expect(t?.program).toBe("pump");
  expect(typeof t?.ix).toBe("number");
  expect(t?.data.isBuy).toBe(true);
  expect(BigInt(String(t?.data.quoteAmount))).toBeGreaterThan(0n);
  expect(t?.data.solAmount).toBe("0");
});

test("multihop-buy: a BONDR TradeEvent and a child TradeEvent with distinct ix", () => {
  const { mint } = load("multihop-buy.json");
  const trades = innerEvents(fixture("multihop-buy.json")).filter((e) => e.name === "TradeEvent");
  expect(trades.map((e) => e.data.mint)).toContain(mint);
  expect(trades.some((e) => e.data.mint !== mint)).toBe(true);
  expect(new Set(trades.map((e) => e.ix)).size).toBe(trades.length);
});

test("pool-buy and pool-sell: PumpSwap BuyEvent and SellEvent decoded from program amm", () => {
  for (const [file, name] of [
    ["pool-buy.json", "BuyEvent"],
    ["pool-sell.json", "SellEvent"],
  ] as const) {
    const e = innerEvents(fixture(file)).find((x) => x.name === name);
    expect(e?.program).toBe("amm");
    expect(e?.data.pool).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(BigInt(String(e?.data.baseAmountOut ?? e?.data.baseAmountIn))).toBeGreaterThan(0n);
    expect(BigInt(String(e?.data.quoteAmountIn ?? e?.data.quoteAmountOut))).toBeGreaterThan(0n);
  }
});

test("create-pool: CreatePoolEvent with baseMint = the child", () => {
  const { mint } = load("create-pool.json");
  const e = innerEvents(fixture("create-pool.json")).find((x) => x.name === "CreatePoolEvent");
  expect(e?.program).toBe("amm");
  expect(e?.data.baseMint).toBe(mint);
});

test("complete: CompleteEvent and a decoded PostCompleteBuyEvent", () => {
  const events = innerEvents(fixture("complete.json"));
  expect(events.some((e) => e.name === "CompleteEvent")).toBe(true);
  const post = events.find((e) => e.name === "PostCompleteBuyEvent");
  expect(post?.program).toBe("pump");
  expect(Object.keys(post?.data ?? {}).length).toBeGreaterThan(0);
});

test("ix is the running index of accepted events", () => {
  expect(innerEvents(fixture("launch-burn.json")).map((e) => e.ix)).toEqual(
    innerEvents(fixture("launch-burn.json")).map((_, i) => i),
  );
});

test("forged authority on a pump or PumpSwap self-CPI yields no events", () => {
  for (const file of ["curve-buy.json", "pool-buy.json"]) {
    const tx = fixture(file);
    for (const g of tx.meta?.innerInstructions ?? []) for (const ix of g.instructions) ix.accounts[0] = 0;
    expect(innerEvents(tx)).toEqual([]);
  }
});
