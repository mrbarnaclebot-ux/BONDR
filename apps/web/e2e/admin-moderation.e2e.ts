// Proves moderation end to end through the real worker (ADMIN-07, ADMIN-10, D-13, D-29, D-30, D-34): hiding a
// dev coin by mint shows the status line, the list entry and a "Hide coin" audit row while its token page still
// answers 200, and Unhide reverses it; blocking a fresh wallet and Unblock do the same; refusals show their field
// copy and change nothing. Hidden coins and blocked wallets are shared Neon state, so this file runs in the serial
// admin-serial project and afterAll undoes anything a failed step left behind. Audit rows are append-only (D-33)
// and stay, as the switch spec's do.
import { expect, type Page, request, test } from "@playwright/test";
import { openConsole } from "./admin.ts";
import { adminAccount, adminSignIn, newTestAccount } from "./phantom.ts";

test.describe.configure({ mode: "serial", timeout: 90_000 });

const REASON = "e2e check";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const origin = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin });
const left = { mint: null as string | null, wallet: null as string | null };

test.afterAll(async () => {
  if (!left.mint && !left.wallet) return;
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    // A step changed shared state, so a failed sign-in must fail the run, not leave it changed (WR-E-04).
    expect((await adminSignIn(api, adminAccount())).status(), "afterAll sign-in to undo shared state").toBe(
      200,
    );
    const undo = (data: object) => api.post("/api/admin/moderate", { headers: origin(), data });
    if (left.mint) expect((await undo({ op: "unhide", mint: left.mint })).status()).toBe(200);
    if (left.wallet) expect((await undo({ op: "unblock", wallet: left.wallet })).status()).toBe(200);
  } finally {
    await api.dispose();
  }
});

const panel = (page: Page) => page.getByRole("region", { name: "Moderation", exact: true });
const reason = (page: Page, n: 0 | 1) => panel(page).getByLabel("Reason, shown only here").nth(n);
const firstAction = (page: Page) =>
  page
    .getByRole("region", { name: "Audit log", exact: true })
    .getByRole("row")
    .nth(1)
    .getByRole("cell")
    .nth(2);

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openConsole(page);
});

test("hiding a coin by mint drops it from lists, keeps its page and is audited; Unhide restores it", async ({
  page,
}) => {
  const { coins } = (await (await page.request.get("/api/coins?sort=top")).json()) as {
    coins: { mint: string; symbol: string }[];
  };
  test.skip(!coins[0], "no dev coin to hide");
  const { mint, symbol } = coins[0] as { mint: string; symbol: string };
  await panel(page).getByLabel("Hide a coin from lists").fill(mint);
  await reason(page, 0).fill(REASON);
  left.mint = mint;
  await panel(page).getByRole("button", { name: "Hide coin" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(
    `${symbol} is hidden from lists. Its page stays reachable by link.`,
  );
  const entry = panel(page)
    .getByRole("listitem")
    .filter({ hasText: `${symbol} hidden, ${REASON}` });
  await expect(entry).toBeVisible();
  await expect(firstAction(page)).toHaveText(`Hide coin: ${symbol}`);
  expect((await page.request.get(`/coin/${mint}`)).status()).toBe(200);
  // The plain top list is kept 10 s (lib/coins.ts), so ask with a key nothing has cached: the mint search.
  const found = await (await page.request.get(`/api/coins?q=${mint}`)).json();
  expect(found.coins).toEqual([]);

  await entry.getByRole("button", { name: "Unhide" }).click();
  await expect(entry).toHaveCount(0);
  await expect(firstAction(page)).toHaveText(`Unhide coin: ${symbol}`);
  left.mint = null;
});

test("blocking a deployer reads its line and is audited; Unblock reverses it", async ({ page }) => {
  const wallet = newTestAccount().address;
  await panel(page).getByLabel("Block a deployer from launching").fill(wallet);
  await reason(page, 1).fill(REASON);
  left.wallet = wallet;
  await panel(page).getByRole("button", { name: "Block wallet" }).click();
  await expect(panel(page).getByRole("status")).toHaveText(`${short(wallet)} can no longer launch on BONDR.`);
  const entry = panel(page)
    .getByRole("listitem")
    .filter({ hasText: `Deployer ${short(wallet)} blocked, ${REASON}` });
  await expect(entry).toBeVisible();
  await expect(firstAction(page)).toHaveText(`Block deployer: ${short(wallet)}`);

  await entry.getByRole("button", { name: "Unblock" }).click();
  await expect(entry).toHaveCount(0);
  await expect(firstAction(page)).toHaveText(`Unblock deployer: ${short(wallet)}`);
  left.wallet = null;
});

test("an unknown coin and a missing reason show their field copy and change nothing", async ({ page }) => {
  const query = panel(page).getByLabel("Hide a coin from lists");
  const before = await firstAction(page).textContent();
  await query.fill("zzzzzz");
  await reason(page, 0).fill(REASON);
  await panel(page).getByRole("button", { name: "Hide coin" }).click();
  await expect(panel(page).getByText("No BONDR coin matches zzzzzz.")).toBeVisible();
  await expect(query).toHaveAttribute("aria-invalid", "true");

  await reason(page, 0).fill("");
  await panel(page).getByRole("button", { name: "Hide coin" }).click();
  await expect(panel(page).getByText("Add a reason.")).toBeVisible();
  await expect(reason(page, 0)).toHaveAttribute("aria-invalid", "true");
  await expect(query).toHaveValue("zzzzzz"); // a refusal keeps what was typed
  await page.reload();
  await expect(firstAction(page)).toHaveText(before ?? "");
});
