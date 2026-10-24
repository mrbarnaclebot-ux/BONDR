// The Phase 4 UI-SPEC accessibility matrix: 7 trade panel states at 390, 768 and 1440 (the sheet open from the
// Quick trade bar below 1100px, the column panel at 1440), plus the closed bar at 390 and 768. Each has no
// horizontal scroll, 0 axe violations and a full-page screenshot for the Designer. /api/trade/* is stubbed
// (trade-stubs.ts), so every state is deterministic. Locally the coin is a seeded curve coin; against staging
// (E2E_BASE_URL) it is the first curve coin of /api/coins?sort=top, as in responsive-lists.e2e.ts.
import { expect, type Locator, type Page, request, test } from "@playwright/test";
import postgres from "postgres";
import { row } from "./coin.ts";
import { dropCoin, type Seeded, seedCoin } from "./fixtures.ts";
import { injectPhantom, newTestAccount, preConsent, rootEnv } from "./phantom.ts";
import { gate, PHASE4_SHOTS } from "./shoot.ts";
import { QUOTE_IMPACT, QUOTE_IMPACT_HIGH, QUOTE_SELL, stubTrade, type TradeStubs } from "./trade-stubs.ts";

const STAGING = process.env.E2E_BASE_URL;
const url = STAGING ? undefined : rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll, as in coin.e2e.ts (a worker may come back to this module).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;

test.describe.configure({ timeout: 90_000 }); // a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" }); // settled frames: the sheet appears in place, no flash or rise
test.skip(!STAGING && !sql, "needs DATABASE_URL in the root .env");

type Coin = Pick<Seeded, "mint" | "symbol">;
let coin: Coin;
test.beforeAll(async () => {
  if (STAGING) {
    const api = await request.newContext({ baseURL: STAGING });
    const { coins } = (await (await api.get("/api/coins?sort=top")).json()) as {
      coins: (Coin & { venue: string })[];
    };
    await api.dispose();
    coin = coins.find((c) => c.venue === "curve") as Coin;
    expect(coin, "a curve coin on staging").toBeTruthy();
    return;
  }
  coin = await seedCoin(sql as postgres.Sql, { trades: 2 });
});
test.afterAll(async () => {
  if (sql && coin) await dropCoin(sql, coin.mint);
});

type State = { stubs?: TradeStubs; connect?: boolean; reach: (s: Locator, go: Locator) => Promise<void> };

/** Types 0.5 SOL and waits for the quote's receive row. */
async function pay(s: Locator) {
  await s.getByRole("textbox", { name: "You pay" }).fill("0.5");
  await expect(row(s, "You receive about")).toHaveText(`17,234,567 ${coin.symbol}`);
}
const ready = () => `Buy ${coin.symbol} with 0.50 SOL`;

const STATES: Record<string, State> = {
  "trade-disconnected": {
    connect: false,
    reach: async (s, go) => {
      await pay(s);
      await expect(go).toHaveText("Connect Phantom to trade");
    },
  },
  "trade-buy": {
    reach: async (s, go) => {
      await pay(s);
      await expect(go).toHaveText(ready());
    },
  },
  "trade-sell": {
    stubs: { quote: { json: QUOTE_SELL } },
    reach: async (s, go) => {
      await s.getByRole("button", { name: "Sell", exact: true }).click();
      await s.getByRole("button", { name: "100%", exact: true }).click();
      await expect(row(s, "You receive about")).toHaveText("0.4877 SOL");
      await expect(go).toHaveText(`Sell 17,234,567 ${coin.symbol}`);
    },
  },
  "trade-impact": {
    stubs: { quote: { json: QUOTE_IMPACT } },
    reach: async (s, go) => {
      await pay(s);
      await expect(s.getByRole("status").filter({ hasText: "High price impact." })).toBeVisible();
      await expect(go).toHaveText(ready());
    },
  },
  "trade-impact-high": {
    stubs: { quote: { json: QUOTE_IMPACT_HIGH } },
    reach: async (s, go) => {
      await pay(s);
      await expect(s.getByRole("alert")).toContainText("Very high price impact.");
      await expect(go).toHaveText("Buy anyway, 20.00% price impact");
    },
  },
  "trade-paused": {
    stubs: { quote: { status: 409, json: { error: "paused" } } },
    reach: async (s, go) => {
      await s.getByRole("textbox", { name: "You pay" }).fill("0.5");
      await expect(s.getByRole("status")).toHaveText(
        "Trading pauses for a few seconds while BONDR moves to PumpSwap.",
      );
      await expect(go).toHaveText("Trading paused");
    },
  },
  "trade-result": {
    reach: async (s, go) => {
      await pay(s);
      await expect(go).toHaveText(ready());
      await go.click();
      await expect(
        s.getByRole("status").filter({ hasText: `Bought 17,234,567 ${coin.symbol}.` }),
      ).toBeVisible({
        timeout: 15_000,
      });
    },
  },
};

const bar = (page: Page) => page.getByRole("region", { name: "Quick trade" });

/** The trade surface for this width: the sheet opened from the bar's Buy below 1100px, else the column panel. */
async function surface(page: Page, width: number): Promise<Locator> {
  if (width >= 1100) return page.getByRole("region", { name: `Trade ${coin.symbol}` });
  await bar(page)
    .getByRole("button", { name: `Buy ${coin.symbol}` })
    .click();
  const sheet = page.getByRole("dialog", { name: `Trade ${coin.symbol}` });
  await expect(sheet.getByRole("textbox", { name: "You pay" })).toBeFocused();
  return sheet;
}

for (const width of [390, 768, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const [name, st] of Object.entries(STATES)) {
      test(name, async ({ page }) => {
        await stubTrade(page, st.stubs ?? {});
        // Phantom is installed in every state, so not connected is "Connect Phantom to trade", not "Get Phantom".
        const account = newTestAccount();
        await injectPhantom(page, account);
        await preConsent(page, account.address);
        await page.goto(`/coin/${coin.mint}`);
        const s = await surface(page, width);
        const go = s.locator("form > button");
        if (st.connect ?? true) {
          await go.getByText("Connect Phantom to trade").click();
          await expect(go).toHaveText("Enter an amount");
        }
        await st.reach(s, go);
        await gate(page, name, width, PHASE4_SHOTS);
      });
    }
    if (width < 1100)
      test("trade-bar", async ({ page }) => {
        await stubTrade(page, {});
        await page.goto(`/coin/${coin.mint}`);
        await expect(bar(page).getByText("Mcap", { exact: true })).toBeVisible();
        await gate(page, "trade-bar", width, PHASE4_SHOTS);
      });
  });
}
