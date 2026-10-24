// The UI gate for one surface at one width: no horizontal scroll, 0 axe violations, a full-page shot.
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

const shots = (phase: string) =>
  fileURLToPath(new URL(`../../../.planning/phases/${phase}/screenshots/`, import.meta.url));
const SHOTS = shots("03-indexer-lists-and-token-page");
export const PHASE4_SHOTS = shots("04-trading");
const SUFFIX = process.env.E2E_BASE_URL ? "-staging" : "";

export async function gate(page: Page, name: string, width: number, dir = SHOTS): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // The dev-only Next indicator is not the app; a shot taken mid-scroll draws the sticky header over content.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.mouse.move(0, 0);
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
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
  // An open sheet is fixed to the viewport, so a full-page shot would draw it mid-page over unblurred content.
  const fullPage = (await page.locator("dialog[open]").count()) === 0;
  await page.screenshot({ path: `${dir}${name}-${width}${SUFFIX}.png`, fullPage });
}
