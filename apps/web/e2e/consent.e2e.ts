import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { injectPhantom, newTestAccount, rootEnv, type TestAccount } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
const sql = url ? postgres(url, { max: 1, onnotice: () => {} }) : undefined;
const used: string[] = [];
const HEADING = "Before BONDR remembers this wallet";
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const rows = async (address: string) =>
  (await (sql as postgres.Sql)`select terms_version from wallets where address = ${address}`).length;

test.describe.configure({ timeout: 60_000 }); // a Neon cold start can take several seconds
test.skip(!sql, "needs DATABASE_URL in the root .env");
// Wake a suspended Neon compute first: its resume can outlast the web client's 10 s connect_timeout.
test.beforeAll(async () => {
  if (sql) await sql`select 1`;
});
test.afterAll(async () => {
  if (sql && used.length) await sql`delete from wallets where address in ${sql(used)}`;
  await sql?.end({ timeout: 5 });
});

async function connectFresh(page: Page): Promise<{ account: TestAccount; leaks: string[] }> {
  const account = newTestAccount();
  used.push(account.address);
  const leaks: string[] = [];
  page.on("request", (r) => {
    if (`${r.url()} ${r.postData() ?? ""}`.includes(account.address)) leaks.push(r.url());
  });
  await injectPhantom(page, account);
  await page.goto("/terms");
  await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
  await expect(page.getByRole("dialog", { name: HEADING })).toBeVisible();
  return { account, leaks };
}

test("nothing carries the address before Accept, and Accept stores one row", async ({ page }) => {
  const { account, leaks } = await connectFresh(page);
  const dialog = page.getByRole("dialog", { name: HEADING });
  const accept = dialog.getByRole("button", { name: "Accept and continue" });
  await expect(dialog.getByRole("checkbox")).toBeFocused();
  await expect(accept).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await expect(accept).toBeEnabled();
  expect(leaks).toEqual([]);
  expect(await rows(account.address)).toBe(0);

  await accept.click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const wallet = page.getByRole("banner").getByRole("button", { name: short(account.address) });
  await expect(wallet).toBeFocused();
  expect(await rows(account.address)).toBe(1);

  await wallet.click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();
  await expect(wallet).toBeVisible();
  await expect(dialog).toBeHidden();
});

for (const how of ["Not now", "Escape", "backdrop"] as const) {
  test(`declining with ${how} disconnects and stores nothing`, async ({ page }) => {
    const { account, leaks } = await connectFresh(page);
    const dialog = page.getByRole("dialog", { name: HEADING });
    await dialog.getByRole("checkbox").check();
    if (how === "Not now") await dialog.getByRole("button", { name: "Not now, disconnect" }).click();
    if (how === "Escape") await page.keyboard.press("Escape");
    if (how === "backdrop") await page.mouse.click(8, 8);
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("banner").getByRole("button", { name: "Connect Phantom" })).toBeVisible();
    expect(leaks).toEqual([]);
    expect(await rows(account.address)).toBe(0);
  });
}

test("a failed save shows the error and re-enables the buttons", async ({ page }) => {
  await page.route("**/api/consent", (route) => route.fulfill({ status: 503 }));
  await connectFresh(page);
  const dialog = page.getByRole("dialog", { name: HEADING });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Accept and continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Could not save your answer. Check your connection and try again.",
  );
  await expect(dialog.getByRole("button", { name: "Accept and continue" })).toBeEnabled();
  await expect(dialog.getByRole("button", { name: "Not now, disconnect" })).toBeEnabled();
});

test("the terms link opens /terms in a new tab", async ({ page }) => {
  await connectFresh(page);
  const link = page.getByRole("dialog", { name: HEADING }).getByRole("link", { name: "terms" });
  await expect(link).toHaveAttribute("href", "/terms");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("POST /api/consent refuses cross-site, malformed and oversized bodies", async ({ request, baseURL }) => {
  const wallet = newTestAccount().address;
  const origin = new URL(baseURL as string).origin;
  const post = (headers: Record<string, string>, data: unknown) =>
    request.post("/api/consent", { headers: { "content-type": "application/json", ...headers }, data });
  expect((await post({ origin: "https://attacker.invalid" }, { wallet })).status()).toBe(403);
  expect((await post({ origin }, { wallet: "0OIl-not-base58" })).status()).toBe(400);
  expect((await post({ origin }, { wallet, pad: "x".repeat(20_000) })).status()).toBe(400);
  expect((await post({ origin, "content-type": "text/plain" }, JSON.stringify({ wallet }))).status()).toBe(
    400,
  );
  expect(await rows(wallet)).toBe(0);
});
