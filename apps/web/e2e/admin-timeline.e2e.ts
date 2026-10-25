// Proves the Timeline panel (ADMIN-08, D-13, D-31): a user pick moves focus to the Timeline h2, the stuck box
// reads contract copy, a non-applicable action stays focusable and announces its reason, Hold for review and
// Re-check launch run with no dialog and write their result line, and no transaction button renders without
// onTx (06-18). Stubbed: the overview's rows and memory, the coin op and the act op, so no DB row is written.
import type { AdminCoinMemory } from "@bondr/core/api-admin";
import { expect, type Page, test } from "@playwright/test";
import type { WRow } from "../lib/admin-data.ts";
import type { CoinTimeline } from "../lib/admin-timeline.ts";
import { openConsole } from "./admin.ts";

const H = 3_600_000;
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const W = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";
const DEPLOYER = "Dep1oyer11111111111111111111111111111111111";

const coin = (mint: string, symbol: string, over: Partial<WRow> = {}): WRow => ({
  ...{ mint, symbol, name: `${symbol} coin`, image: null, w: W, venue: "curve", finalize: "none" },
  ...{ feeBudget: "100", feesUnclaimed: "0", cost: "1000", bondrSol: 0.001, launchedAt: iso(5 * H) },
  ...{ lastCollectAt: iso(H), heldAt: null, heldReason: null, bondSent: false, bondedAt: null },
  launch: "landed",
  ...over,
});
const ROWS: WRow[] = [
  coin("Stuck1111", "STUK", { venue: "pool", bondedAt: iso(4 * H) }),
  coin("Unconf111", "UNCF", { launch: "unconfirmed", cost: null }),
  coin("Coll11111", "COLL"),
];
const MEMORY: AdminCoinMemory[] = [
  {
    mint: "Stuck1111",
    stuck: { step: "finalize", attempts: 3, code: "blockhash_expired", at: Date.now() - H },
    hold: null,
    busy: false,
  },
];
const BALANCES = {
  ...{ treasurySol: "0", treasuryBondr: "0", buybackSol: "0", buybackBondr: "0", opsSol: "1000000000" },
  ...{ opsFloor: "100000000", bondrSol: null, nextBurnAt: Date.now() + H },
};

const timeline = (mint: string): CoinTimeline => ({
  launch: {
    ...{ state: mint === "Unconf111" ? "sent" : "landed", exit: "burn", solIn: "500000000" },
    ...{
      signature: `${mint}LaunchSig`,
      wallet: DEPLOYER,
      tokens: null,
      landedAt: null,
      createdAt: iso(5 * H),
    },
  },
  rows:
    mint === "Stuck1111"
      ? [
          {
            ...{ kind: "finalize_config", state: "landed", amount: null, burned: null, sol: null },
            ...{ signature: "ConfigSig1111", windowIndex: null, detail: null },
            ...{ createdAt: iso(3 * H), landedAt: iso(3 * H) },
          },
        ]
      : [],
});

// The real overview answer with its rows and memory replaced; the coin op answers from the fixture.
async function stubbed(page: Page) {
  await page.route("**/api/admin/overview", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.rows = ROWS;
    body.worker = { balances: body.worker?.balances ?? BALANCES, coins: MEMORY };
    await route.fulfill({ response: res, json: body });
  });
  await page.route("**/api/admin/coin", async (route) => {
    const { mint } = route.request().postDataJSON() as { mint: string };
    await route.fulfill({ json: { timeline: timeline(mint), live: null } });
  });
  await openConsole(page);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("button", { name: "STUK, open timeline" })).toBeVisible();
}

// Every act call is answered by the fixture outcome and recorded.
async function acts(page: Page, outcome: string) {
  const sent: Record<string, unknown>[] = [];
  await page.route("**/api/admin/act", async (route) => {
    sent.push(route.request().postDataJSON());
    await route.fulfill({ json: { outcome } });
  });
  return sent;
}

const timelineOf = (page: Page) => page.getByRole("region", { name: /^Timeline/ });

test.describe("admin-timeline", () => {
  test.describe.configure({ timeout: 90_000 });

  test("a pick focuses the Timeline, the stuck box reads contract copy, a greyed action explains itself", async ({
    page,
  }) => {
    await stubbed(page);
    await page.getByRole("button", { name: "STUK, open timeline" }).click();
    const h2 = page.getByRole("heading", { level: 2, name: "Timeline, STUK" });
    await expect(h2).toBeFocused();
    const panel = timelineOf(page);
    const steps = panel.getByRole("list", { name: "STUK timeline" });
    await expect(steps.getByText("Stuck: update_fee_shares_v2")).toBeVisible();
    await expect(
      panel.getByText(
        /^Last error 1h \dm ago: blockhash expired after send, 3 of 3 attempts\. Pre-flight: deployer Dep1…1111 matches the launch signer\.$/,
      ),
    ).toBeVisible();
    const recheck = panel.getByRole("button", { name: "Re-check launch" });
    await expect(recheck).toHaveAttribute("aria-disabled", "true");
    await recheck.focus();
    await expect(recheck).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      panel.getByText("Re-check launch applies only to a launch that is still signed, sent or unknown."),
    ).toBeVisible();
  });

  test("Hold for review runs at once and writes its result line", async ({ page }) => {
    await stubbed(page);
    const sent = await acts(page, "held");
    await page.getByRole("button", { name: "COLL, open timeline" }).click();
    const panel = timelineOf(page);
    await expect(panel.getByRole("heading", { name: "Timeline, COLL" })).toBeVisible();
    await panel.getByRole("button", { name: "Hold for review" }).click();
    await expect(panel.getByText("Held COLL for review.")).toBeVisible();
    expect(sent).toEqual([{ action: "hold", mint: "Coll11111", reason: "Held for review from the console" }]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("Re-check launch on an unconfirmed launch reports not on chain", async ({ page }) => {
    await stubbed(page);
    const sent = await acts(page, "not_on_chain");
    await page.getByRole("button", { name: "UNCF, open timeline" }).click();
    const panel = timelineOf(page);
    await expect(
      panel.getByRole("list", { name: "UNCF timeline" }).getByText("Re-check launch"),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Re-check launch" }).click();
    await expect(panel.getByText("The launch is not on chain yet. Nothing changed.")).toBeVisible();
    expect(sent).toEqual([{ action: "recheck_launch", mint: "Unconf111" }]);
  });

  test("no transaction button renders before 06-18 passes onTx", async ({ page }) => {
    await stubbed(page);
    const panel = timelineOf(page);
    await expect(panel.getByRole("heading", { name: "Timeline, STUK" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Hold for review" })).toHaveCount(2); // stuck box and grid
    const tx =
      /Sweep now|Retry forced bond|Burn W token|Run migrate|Finalize split|Retry sweep|Distribute now|Sweep leftovers/;
    await expect(panel.getByRole("button", { name: tx })).toHaveCount(0);
  });
});
