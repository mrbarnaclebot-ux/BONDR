import type { TradeQuote } from "@bondr/core/api";
import { expect, test } from "vitest";
import { type ButtonInput, buttonState } from "./trade-button";

const QUOTE = { side: "buy", impact: 0.0123 } as TradeQuote;
const SELL_QUOTE = { side: "sell", impact: 0.0123 } as TradeQuote;
const URL = "https://bondr.test/coin/abc";

// A ready 1 SOL buy; each test changes what its row needs.
const READY: ButtonInput = {
  wallet: "connected",
  consented: true,
  mobile: false,
  url: URL,
  coinComplete: false,
  side: "buy",
  symbol: "GRUB",
  units: 1_000_000_000n,
  balance: { sol: "2500000000", tokens: "17234567000000" },
  quote: QUOTE,
  loading: false,
  quoteError: null,
  paused: false,
  phase: "idle",
};
// A quote without amountIn is for the input's amount; a test of a stale quote sets its own.
const at = (o: Partial<ButtonInput>) => {
  const i = { ...READY, ...o };
  return buttonState(
    i.quote?.amountIn ? i : { ...i, quote: i.quote && { ...i.quote, amountIn: String(i.units) } },
  );
};

test("wallet loading or consent being read", () => {
  expect(at({ wallet: "loading" })).toMatchObject({ label: "Checking wallet…", disabled: true });
  expect(at({ consented: null })).toMatchObject({ label: "Checking wallet…", disabled: true });
});

test("Phantom missing on desktop links to the download page", () => {
  expect(at({ wallet: "missing" })).toMatchObject({
    label: "Get Phantom",
    action: "link",
    href: "https://phantom.com/download",
  });
});

test("Phantom missing on mobile opens BONDR in Phantom", () => {
  const s = at({ wallet: "missing", mobile: true });
  expect(s.label).toBe("Open BONDR in Phantom");
  expect(s.href).toBe(
    `https://phantom.com/ul/browse/${encodeURIComponent(URL)}?ref=${encodeURIComponent("https://bondr.test")}`,
  );
});

test("not connected connects", () => {
  expect(at({ wallet: "idle" })).toMatchObject({
    label: "Connect Phantom to trade",
    action: "connect",
    icon: "wallet",
    variant: "primary",
  });
});

test("connecting", () => {
  expect(at({ wallet: "connecting" })).toMatchObject({ label: "Opening Phantom…", disabled: true });
});

test("connected without consent reopens consent", () => {
  expect(at({ consented: false })).toMatchObject({ label: "Accept terms to trade", action: "consent" });
});

test("coin migrating or a paused quote", () => {
  expect(at({ coinComplete: true })).toMatchObject({ label: "Trading paused", disabled: true });
  expect(at({ quote: null, quoteError: "paused" })).toMatchObject({
    label: "Trading paused",
    disabled: true,
  });
});

test("no amount", () => {
  expect(at({ units: null })).toMatchObject({ label: "Enter an amount", disabled: true });
});

test("a buy over the devnet cap (C-WR-02)", () => {
  const capped = { ...QUOTE, maxSolIn: "700000000" };
  expect(at({ quote: capped })).toMatchObject({ label: "Enter an amount", disabled: true, action: null });
  expect(at({ quote: capped, units: 700_000_000n }).label).toBe("Buy GRUB with 0.70 SOL");
});

test("a buy over balance minus 0.01 SOL", () => {
  const s = at({ units: 2_495_000_000n });
  expect(s).toMatchObject({ label: "Not enough SOL", disabled: true });
  expect(s.hint).toBe("Your wallet has 2.5 SOL. Keep about 0.01 SOL for fees.");
  expect(at({ units: 2_490_000_000n }).label).toBe("Buy GRUB with 2.49 SOL");
});

test("a sell over the coin balance", () => {
  const s = at({ side: "sell", quote: SELL_QUOTE, units: 17_234_567_000_001n });
  expect(s).toMatchObject({ label: "Not enough GRUB", disabled: true });
  expect(s.hint).toBe("Your wallet has 17,234,567 GRUB.");
});

test("first quote loading", () => {
  expect(at({ quote: null, loading: true })).toMatchObject({ label: "Getting quote…", disabled: true });
});

test("quote failed with none shown", () => {
  expect(at({ quote: null, quoteError: "failed" })).toMatchObject({ label: "No quote yet", disabled: true });
});

test("quote paused refreshes", () => {
  expect(at({ paused: true })).toMatchObject({
    label: "Quote paused, tap to refresh",
    variant: "quiet",
    action: "refresh",
    icon: "refresh",
    disabled: false,
  });
});

test("impact over 15% asks for anyway", () => {
  expect(at({ quote: { ...QUOTE, impact: 0.2 } })).toMatchObject({
    label: "Buy anyway, 20.00% price impact",
    variant: "danger",
    action: "submit",
  });
  expect(at({ side: "sell", quote: { ...SELL_QUOTE, impact: 0.2 }, units: 1n }).label).toBe(
    "Sell anyway, 20.00% price impact",
  );
  expect(at({ quote: { ...QUOTE, impact: 0.15 } }).label).toBe("Buy GRUB with 1.00 SOL");
});

test("a quote for another amount or side, or one being replaced, never arms the button (C-CR-01)", () => {
  const old = { ...QUOTE, amountIn: "500000000" };
  expect(at({ quote: old })).toMatchObject({ label: "Getting quote…", disabled: true, action: null });
  // The over-15% quote for 0.5 SOL never stands in for 1 SOL either way.
  expect(at({ quote: { ...old, impact: 0.2 } }).action).toBeNull();
  expect(at({ quote: old, quoteError: "failed" })).toMatchObject({ label: "No quote yet", action: null });
  expect(at({ side: "sell", quote: QUOTE }).action).toBeNull();
  expect(at({ loading: true })).toMatchObject({ label: "Getting quote…", action: null });
});

test("ready buy", () => {
  expect(READY.phase).toBe("idle");
  expect(at({})).toMatchObject({
    label: "Buy GRUB with 1.00 SOL",
    variant: "primary",
    action: "submit",
    disabled: false,
    ariaDisabled: false,
  });
  expect(at({ units: 125_000_000n }).label).toBe("Buy GRUB with 0.125 SOL");
});

test("ready sell", () => {
  const sell = (units: bigint) => at({ side: "sell", quote: SELL_QUOTE, units });
  expect(sell(1_234_000_000n)).toMatchObject({
    label: "Sell 1,234 GRUB",
    variant: "danger",
    action: "submit",
  });
  expect(sell(500_000n).label).toBe("Sell 0.5 GRUB");
  expect(sell(17_234_567_000_000n).label).toBe("Sell 17,234,567 GRUB");
});

test("in flight keeps the variant and focus", () => {
  const steps = [
    ["preparing", "Preparing trade…"],
    ["signing", "Waiting for Phantom…"],
    ["confirming", "Confirming…"],
  ] as const;
  for (const [phase, label] of steps) {
    expect(at({ phase })).toMatchObject({ label, variant: "primary", ariaDisabled: true, disabled: false });
    expect(at({ phase }).action).toBeNull();
    expect(at({ phase }).icon).toBe("loader");
    expect(at({ phase, side: "sell", quote: SELL_QUOTE }).variant).toBe("danger");
  }
});
