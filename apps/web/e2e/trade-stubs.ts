// Stubbed trade routes for trade.e2e.ts and the later trade specs. page.route answers quote, balance, prepare,
// submit and the trade read in the browser, so nothing reaches the worker or the chain. Fixture amounts are
// chosen so every string a spec asserts is a literal (0.5 SOL in, 1% slippage, devnet-like 95 / 30 bps).
import type { TradeBalance, TradePrepareResult, TradeQuote } from "@bondr/core/api";
import type { Page } from "@playwright/test";
import { fulfill, ID, type Reply, SIG } from "./launch-stubs.ts";

// One empty signature slot (the trader's), then a dummy message; signWire signs slot 0 of it.
const TX = Buffer.concat([Buffer.from([1]), Buffer.alloc(64), Buffer.alloc(600, 7)]).toString("base64");
const NETWORK_MAX = "505000";

/** 0.5 SOL in: "17,234,567" out, "17,062,221" minimum, "1.23%" impact, "Fees 0.0062 SOL". */
export const QUOTE_BUY: TradeQuote = {
  side: "buy",
  amountIn: "500000000",
  amountOut: "17234567000000",
  minAmountOut: "17062221330000",
  impact: 0.0123,
  route: { bondr: "curve", coin: "curve" },
  fees: {
    bondrHop: { venue: "curve", protocolBps: 95, creatorBps: 0, lpBps: 0, sol: "4705299" },
    coinHop: { venue: "curve", protocolBps: 0, creatorBps: 30, lpBps: 0, sol: "1494701" },
    platformFee: "0",
    totalSol: "6200000",
    networkMax: NETWORK_MAX,
  },
};

/** The bought amount back: "0.4877 SOL" out, "0.4828 SOL" minimum, "Fees 0.0062 SOL". */
export const QUOTE_SELL: TradeQuote = {
  side: "sell",
  amountIn: "17234567000000",
  amountOut: "487654321",
  minAmountOut: "482777777",
  impact: 0.0123,
  route: { bondr: "curve", coin: "curve" },
  fees: {
    bondrHop: { venue: "curve", protocolBps: 95, creatorBps: 0, lpBps: 0, sol: "4722260" },
    coinHop: { venue: "curve", protocolBps: 0, creatorBps: 30, lpBps: 0, sol: "1477740" },
    platformFee: "0",
    totalSol: "6200000",
    networkMax: NETWORK_MAX,
  },
};

/** The coin on PumpSwap: the coin hop carries LP and creator, the BONDR hop protocol only. */
export const QUOTE_POOL: TradeQuote = {
  ...QUOTE_BUY,
  route: { bondr: "curve", coin: "pool" },
  fees: {
    ...QUOTE_BUY.fees,
    coinHop: { venue: "pool", protocolBps: 0, creatorBps: 5, lpBps: 20, sol: "1494701" },
  },
};

/** "20.00%" impact, over the D-13 15% line. */
export const QUOTE_IMPACT_HIGH: TradeQuote = { ...QUOTE_BUY, impact: 0.2 };

/** "Balance 2.5000 SOL" and exactly the tokens QUOTE_BUY buys. */
export const BALANCE: TradeBalance = { sol: "2500000000", tokens: "17234567000000" };

export const PREPARED: TradePrepareResult = {
  tradeId: ID,
  tx: TX,
  signBy: 60,
  expectedOut: QUOTE_BUY.amountOut,
  minAmountOut: QUOTE_BUY.minAmountOut,
};

export const tradeView = (state: string, extra: object = {}) => ({ state, signature: SIG, ...extra });

export type TradeStubs = {
  quote?: Reply;
  balance?: Reply;
  prepare?: Reply;
  submit?: Reply;
  view?: (n: number) => Reply;
};
// quote, prepare and submit keep each request body, so a spec can check what the browser sent.
export type TradeCalls = {
  quote: unknown[];
  balance: number;
  prepare: unknown[];
  submit: unknown[];
  view: number;
};

export async function stubTrade(page: Page, s: TradeStubs): Promise<TradeCalls> {
  const calls: TradeCalls = { quote: [], balance: 0, prepare: [], submit: [], view: 0 };
  await page.route("**/api/trade/quote", (r) => {
    calls.quote.push(r.request().postDataJSON());
    return fulfill(r, s.quote ?? { json: QUOTE_BUY });
  });
  await page.route("**/api/trade/balance", (r) => {
    calls.balance++;
    return fulfill(r, s.balance ?? { json: BALANCE });
  });
  await page.route("**/api/trade/prepare", (r) => {
    calls.prepare.push(r.request().postDataJSON());
    return fulfill(r, s.prepare ?? { json: PREPARED });
  });
  await page.route("**/api/trade/submit", (r) => {
    calls.submit.push(r.request().postDataJSON());
    return fulfill(r, s.submit ?? { json: { state: "sent", signature: SIG } });
  });
  await page.route(/\/api\/trade\/[0-9a-f]{32}$/, (r) =>
    fulfill(r, s.view?.(++calls.view) ?? { json: tradeView("landed", { amountOut: QUOTE_BUY.amountOut }) }),
  );
  return calls;
}
