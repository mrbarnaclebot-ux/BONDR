// The UI-SPEC accessibility matrix: 12 surfaces at 390, 768 and 1440, each with no horizontal scroll,
// 0 axe violations and a full-page screenshot for the Designer. Steps 4 and 5 use the launch-live stubs,
// so nothing reaches the chain; the coin page reads the newest landed launch from the dev branch.
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { field, liveStatus, panel, row, solText, toStep2, toStep3 } from "./coin.ts";
import { FACTS, signRow, stub, toSign, view } from "./launch-stubs.ts";
import { injectPhantom, newTestAccount, rootEnv } from "./phantom.ts";

const SHOTS = fileURLToPath(
  new URL("../../../.planning/phases/02-launch-flow/screenshots/", import.meta.url),
);
const SUFFIX = process.env.E2E_BASE_URL ? "-staging" : "";
const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker runs afterAll when it leaves this file
// and reuses the module if it comes back, and an ended client refuses every query (CONNECTION_ENDED).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

test.describe.configure({ timeout: 90_000 }); // live status and a Neon cold start can take seconds
test.use({ reducedMotion: "reduce" }); // settled frames: the panel rise and orb rings would blur shots

const visible = (page: Page, name: string) =>
  expect(page.getByRole("heading", { name })).toBeVisible({ timeout: 20_000 });

/** Each surface's walk to its state; it returns once the state is on screen. */
const SURFACES: Record<string, (page: Page) => Promise<void>> = {
  "launch-step1": async (page) => {
    await page.goto("/launch");
    await expect(page.getByRole("button", { name: "Continue to dev buy" })).toBeVisible();
  },
  "launch-step2": async (page) => {
    const { minLamports } = await liveStatus(page);
    await page.goto("/launch");
    await toStep2(page);
    await field(page, "Dev buy").fill(solText(minLamports as string));
    await expect(page.getByText(/About [\d.,]+[KMB]? tokens\./)).toBeVisible({ timeout: 20_000 });
  },
  "launch-step2-errors": async (page) => {
    const { minLamports } = await liveStatus(page);
    await page.goto("/launch");
    await toStep2(page);
    await field(page, "Dev buy").fill(String(Number(solText(minLamports as string)) / 2));
    await expect(page.getByText(/^Minimum dev buy is/)).toBeVisible();
  },
  "launch-step3": async (page) => {
    await injectPhantom(page, newTestAccount()); // installed, not connected: the button the mockup shows
    await page.goto("/launch");
    await toStep2(page);
    await toStep3(page, (await liveStatus(page)).minLamports as string);
    await expect(row(panel(page, "Step 3 of 5: Review"), "Dev buy")).toHaveText(/about [\d.]+[KMB]? GRUB/, {
      timeout: 20_000,
    });
  },
  "launch-step4": async (page) => {
    await stub(page, { view: () => ({ json: view("sent") }) });
    await toSign(page, newTestAccount());
    await expect(signRow(page, 5)).toHaveAttribute("data-state", "now");
  },
  "launch-step4-rejected": async (page) => {
    await stub(page, {});
    await toSign(page, newTestAccount(), { reject: true });
    await expect(signRow(page, 3)).toHaveAttribute("data-state", "failed");
  },
  "launch-step5": async (page) => {
    await stub(page, { view: () => ({ json: view("landed", { facts: FACTS }) }) });
    await toSign(page, newTestAccount());
    await expect(page.getByRole("heading", { name: "GRUB is live." })).toBeFocused({ timeout: 15_000 });
  },
  "launch-paused": async (page) => {
    await page.route("**/api/status", async (r) => {
      const real = await (await r.fetch()).json();
      await r.fulfill({ json: { ...real, paused: "kill_switch" } });
    });
    await page.goto("/launch");
    await expect(page.getByRole("status").filter({ hasText: "Launches are paused." })).toBeVisible();
  },
  // A fresh wallet, declined by closing the page, so no consent row is written.
  consent: async (page) => {
    await injectPhantom(page, newTestAccount());
    await page.goto("/launch");
    await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
    await expect(page.getByRole("dialog", { name: "Before BONDR remembers this wallet" })).toBeVisible();
  },
  terms: async (page) => {
    await page.goto("/terms");
    await visible(page, "Terms");
  },
  coin: async (page) => {
    test.skip(!sql, "needs DATABASE_URL in the root .env");
    const [row] = await (sql as postgres.Sql)<{ mint: string }[]>`select mint from launches
      where state = 'landed' order by created_at desc limit 1`;
    await page.goto(`/coin/${row?.mint}`);
    await expect(page.getByRole("complementary", { name: "Launch supply proof" })).toBeVisible();
  },
  "coin-404": async (page) => {
    await page.goto(`/coin/${Array.from({ length: 44 }, (_, i) => B58[(i * 7) % 58]).join("")}`);
    await visible(page, "No BONDR coin here");
  },
};

for (const width of [390, 768, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const [name, reach] of Object.entries(SURFACES)) {
      test(name, async ({ page }) => {
        await reach(page);
        await page.evaluate(() => document.fonts.ready);
        // The dev-only Next indicator is not the app, and a full-page shot taken mid-scroll draws the
        // sticky header (and its backdrop blur) over the content.
        await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.mouse.move(0, 0); // no hover state left on the last clicked control
        // The elements past the right edge name the culprit when the widths differ.
        const { scroll, client, wide } = await page.evaluate(() => {
          const client = document.documentElement.clientWidth;
          const wide = [...document.querySelectorAll("body *")]
            .filter((e) => e.getBoundingClientRect().right > client)
            .map((e) => `${e.tagName.toLowerCase()}.${e.className}`.slice(0, 80));
          return { scroll: document.documentElement.scrollWidth, client, wide };
        });
        expect(scroll, `horizontal scroll from ${wide.join(" | ")}`).toBe(client);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const found = violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
        expect(found).toEqual([]);
        // The consent sheet is fixed to the viewport, so a full-page stitch would float it mid-page.
        const fullPage = name !== "consent";
        await page.screenshot({ path: `${SHOTS}${name}-${width}${SUFFIX}.png`, fullPage });
      });
    }
  });
}

// UI-SPEC: no horizontal scroll from 320 up. The devnet header (brand, badge, wallet) is the widest row.
test("the header fits at 320", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto("/coin/not-a-mint");
  await page.evaluate(() => document.fonts.ready);
  const wallet = await page
    .getByRole("banner")
    .getByRole("button", { name: "Connect Phantom" })
    .boundingBox();
  expect((wallet?.x ?? 0) + (wallet?.width ?? 0)).toBeLessThanOrEqual(320 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
