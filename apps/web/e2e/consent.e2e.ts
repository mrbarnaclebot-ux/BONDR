import { createHmac, randomInt, sign } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { consentMessage } from "../lib/terms.ts";
import { injectPhantom, newTestAccount, rootEnv, signIn } from "./phantom.ts";

const url = rootEnv().DATABASE_URL;
// idle_timeout instead of end() in afterAll: a fullyParallel worker runs afterAll when it leaves this file
// and reuses the module if it comes back, and an ended client refuses every query (CONNECTION_ENDED).
const sql = url ? postgres(url, { max: 1, idle_timeout: 5, onnotice: () => {} }) : undefined;
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
});

async function connectFresh(page: Page, o: { reject?: boolean } = {}) {
  const account = newTestAccount();
  used.push(account.address);
  const leaks: string[] = [];
  page.on("request", (r) => {
    if (`${r.url()} ${r.postData() ?? ""}`.includes(account.address)) leaks.push(r.url());
  });
  const { messages } = await injectPhantom(page, account, o);
  await page.goto("/terms");
  await connect(page);
  await expect(page.getByRole("dialog", { name: HEADING })).toBeVisible();
  return { account, leaks, messages };
}

const connect = (page: Page) =>
  page.getByRole("banner").getByRole("button", { name: "Connect Phantom" }).click();

test("nothing carries the address before Accept; Accept signs once and a reload keeps the session", async ({
  page,
}) => {
  const { account, leaks, messages } = await connectFresh(page);
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
  expect(messages).toHaveLength(1);
  expect(messages[0]).toContain("BONDR consent");
  expect(messages[0]).toContain(`Wallet: ${account.address}`);

  await wallet.click();
  await page.getByRole("button", { name: "Disconnect" }).click();
  await connect(page);
  await expect(wallet).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.reload();
  await connect(page);
  await expect(wallet).toBeVisible();
  await page.waitForLoadState("networkidle"); // the session read has answered
  await expect(dialog).toBeHidden();
  expect(messages).toHaveLength(1);
});

test("rejecting the signature in Phantom records nothing and keeps the dialog open", async ({ page }) => {
  const { account } = await connectFresh(page, { reject: true });
  const dialog = page.getByRole("dialog", { name: HEADING });
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Accept and continue" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Phantom rejected the request. Nothing was saved.");
  await expect(dialog.getByRole("button", { name: "Accept and continue" })).toBeEnabled();
  expect(await rows(account.address)).toBe(0);
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
  expect((await post({ origin }, { wallet })).status()).toBe(400); // no signature
  const { nonce } = await (await request.get("/api/consent")).json();
  const unsigned = await post({ origin }, { wallet, nonce, signature: Buffer.alloc(64).toString("base64") });
  expect(unsigned.status()).toBe(403);
  expect(await unsigned.json()).toEqual({ error: "consent_required" });
  expect(await rows(wallet)).toBe(0);
});

test("a captured consent signature works once, even across a web restart (CR-01)", async ({
  request,
  baseURL,
}) => {
  const account = newTestAccount();
  used.push(account.address);
  const headers = { origin: new URL(baseURL as string).origin, "x-real-ip": `10.7.${randomInt(256)}.1` };
  const { nonce, expires } = await (await request.get("/api/consent", { headers })).json();
  const message = Buffer.from(consentMessage(account.address, nonce, expires));
  const data = {
    wallet: account.address,
    nonce,
    signature: sign(null, message, account.key).toString("base64"),
  };
  expect((await request.post("/api/consent", { headers, data })).status()).toBe(204);
  const replay = await request.post("/api/consent", { headers, data });
  expect(replay.status()).toBe(403);
  // The spent nonce is a row, not process memory, so a restart cannot forget it.
  expect((await (sql as postgres.Sql)`select 1 from consent_nonces where nonce = ${nonce}`).length).toBe(1);
});

test("the launch routes take the wallet from the session, never from the body", async ({ request }) => {
  const [owner, forged] = [newTestAccount(), newTestAccount()];
  used.push(owner.address);
  const headers = { origin: new URL(test.info().project.use.baseURL as string).origin };
  const { minLamports } = await (await request.get("/api/status")).json();
  const cid = "b".repeat(59);
  const fields = {
    name: "Forged",
    symbol: "FRG",
    links: {},
    uri: `https://ipfs.io/ipfs/${cid}`,
    imageCid: cid,
  };
  // The pin route's proof (lib/session.ts pinProof), so prepare reaches the worker without a real pin.
  const proof = createHmac("sha256", rootEnv().SESSION_SECRET ?? "")
    .update(JSON.stringify(["pin", fields.uri, cid]))
    .digest("base64url");
  const data = { ...fields, proof, solIn: minLamports, exit: "burn", wallet: owner.address };
  const prepare = () => request.post("/api/launch/prepare", { headers, data });

  // No session: refused before the worker, whatever wallet the body names.
  expect(await (await prepare()).json()).toEqual({ error: "consent_required" });
  const submit = await request.post("/api/launch/submit", {
    headers,
    data: { launchId: "a".repeat(32), signed: "x" },
  });
  expect(await submit.json()).toEqual({ error: "consent_required" });

  expect((await signIn(request, owner)).status()).toBe(204);
  // Metadata the pin route did not build is refused before the worker (worker-core WR-06).
  const unpinned = await request.post("/api/launch/prepare", { headers, data: { ...data, proof: "x" } });
  expect(await unpinned.json()).toEqual({ error: "invalid_input" });
  // The body names an unconsented wallet, but the worker gets the session's consented one: it passes the consent
  // check and stops at the balance (a fresh key holds 0 SOL) or the pool, so nothing is spent.
  data.wallet = forged.address;
  const res = await prepare();
  expect(["insufficient_balance", "pool_empty"]).toContain((await res.json()).error);
  expect(await rows(forged.address)).toBe(0);
});
