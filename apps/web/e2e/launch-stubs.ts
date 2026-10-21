// Stubbed launch routes and the walk to step 4, for launch-live.e2e.ts. page.route answers pin, prepare,
// submit and the launch read in the browser, so nothing reaches the worker or the chain.
import type { Page, Route } from "@playwright/test";
import { liveStatus, toStep2, toStep3 } from "./coin.ts";
import { injectPhantom, preConsent, type TestAccount } from "./phantom.ts";

export const ID = "a".repeat(32);
export const MINT = "Mint111111111111111111111111111111111bndr";
export const SIG = "5".repeat(88);
export const CID = `bafkrei${"c".repeat(52)}`;
const PIN = { uri: `https://ipfs.io/ipfs/${CID}`, cid: CID, imageCid: CID };
const TX = Buffer.concat([Buffer.from([2]), Buffer.alloc(128), Buffer.alloc(600, 7)]).toString("base64");
const PREVIEW = { createCost: "8829040", networkFee: "10600", solBack: null, tokensOut: "31120363129478" };
export const FACTS = { tokens: "31120363129478", devChildAfter: "0" };
export const PREPARED = { launchId: ID, tx: TX, mint: MINT, bytes: 769, signBy: 60, preview: PREVIEW };

export type Reply = { status?: number; json: unknown; delayMs?: number };
export type Stubs = { pin?: Reply; prepare?: Reply; submit?: Reply; view?: (n: number) => Reply };
export type Calls = { prepare: number; submit: number; view: number; signed: string };

export const view = (state: string, extra: object = {}) => ({
  id: ID,
  state,
  mint: MINT,
  name: "Grubworm",
  symbol: "GRUB",
  exit: "burn",
  solIn: "2500000",
  signature: SIG,
  error: null,
  facts: null,
  imageCid: CID,
  links: {},
  wallet: "w",
  createdAt: new Date().toISOString(),
  ...extra,
});

async function fulfill(route: Route, r: Reply) {
  if (r.delayMs) await new Promise((done) => setTimeout(done, r.delayMs));
  await route.fulfill({ status: r.status ?? 200, json: r.json });
}

export async function stub(page: Page, s: Stubs): Promise<Calls> {
  const calls: Calls = { prepare: 0, submit: 0, view: 0, signed: "" };
  await page.route("**/api/launch/pin", (r) => fulfill(r, s.pin ?? { json: PIN }));
  await page.route("**/api/launch/prepare", (r) => {
    calls.prepare++;
    return fulfill(r, s.prepare ?? { json: PREPARED });
  });
  await page.route("**/api/launch/submit", (r) => {
    calls.submit++;
    calls.signed = (r.request().postDataJSON() as { signed: string }).signed;
    return fulfill(r, s.submit ?? { json: { state: "sent", signature: SIG } });
  });
  await page.route(/\/api\/launch\/[0-9a-f]{32}$/, (r) =>
    fulfill(r, s.view?.(++calls.view) ?? { json: view("landed", { facts: FACTS }) }),
  );
  return calls;
}

export const signRow = (page: Page, n: number) =>
  page.locator('ol[aria-label="Launch progress"] > li').nth(n - 1);
export const back = (page: Page) => page.getByRole("button", { name: "Back to review" });

/** Steps 1-3 with the given wallet, then Sign in Phantom. Some faults leave step 4 at once, so no wait here. */
export async function toSign(
  page: Page,
  account: TestAccount,
  o: { reject?: boolean; symbol?: string } = {},
) {
  const { minLamports } = await liveStatus(page);
  await injectPhantom(page, account, { reject: o.reject });
  await preConsent(page, account.address);
  await page.goto("/launch");
  await toStep2(page, o.symbol ? `BONDR e2e ${o.symbol}` : undefined, o.symbol);
  await toStep3(page, minLamports as string);
  await page.getByRole("button", { name: "Connect Phantom to launch" }).click();
  await page.getByRole("button", { name: "Sign in Phantom" }).click();
}
