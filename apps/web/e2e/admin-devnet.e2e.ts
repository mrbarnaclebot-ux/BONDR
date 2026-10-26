// The owner console's money path on real devnet (D-37, D-39; ADMIN-01, ADMIN-03, ADMIN-04, ADMIN-10, ADMIN-11),
// E2E_DEVNET_ADMIN=1 only, alone: its own devnet-admin project, and it fails if E2E_DEVNET=1 is set too, since the
// E2E_DEVNET specs need FEE_ENGINE=on and live launches (CR-E-02). It needs a worker started by hand with
// ADMIN_WALLET set to the test admin address, ADMIN_EVACUATE=on, FEE_ENGINE=off and VANITY_THREADS=0 (the command
// is in apps/worker/README.md), and a web dev server with the same ADMIN_WALLET (playwright.config.ts starts one);
// beforeAll checks both before any spend. Stop that worker after the run: local and staging share the devnet ops
// wallet (Pitfall 12). In order: Sweep now on a dev-DB curve coin after two real trades, Burn buyback now,
// Re-check launch on a crafted unconfirmed launch (nothing changes), then EVACUATE once no other W holds anything
// and no dev coin is a staging coin. afterAll restores the switches and settings.evacuated_at it found and fails
// when the run's net devnet spend (ops plus sim) passes 0.05 SOL.
import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import bs58 from "bs58";
import { openConsole } from "./admin.ts";
import {
  type Coin,
  db,
  env,
  fullW,
  hasDb,
  ledgerMark,
  logRows,
  pickCoin,
  preflight,
  Q,
  restore,
  rowsAfter,
  type Settings,
  seedW,
  settings,
  signAndSend,
  sim,
  stagingMints,
} from "./admin-devnet-steps.ts";
import { lamports, RUN_BUDGET_LAMPORTS, sol, supply, tokens, trade, WORKER } from "./devnet.ts";
import { adminAccount, injectPhantom, preConsent, seedAccount } from "./phantom.ts";

const STAGING = "https://web-staging-72bad.up.railway.app";
const PHRASE = "EVACUATE ALL W TO TREASURY";
const SWITCHES = ["Launches", "Forced bond", "Sweeps", "Finalize", "Buyback burn"];

test.describe.configure({ mode: "serial", timeout: 25 * 60_000 });
test.skip(
  process.env.E2E_DEVNET_ADMIN !== "1" || !hasDb,
  "real devnet console money path: E2E_DEVNET_ADMIN=1",
);

const ops = seedAccount("ops:devnet:main").address;
const buyback = seedAccount(`buyback:devnet:${env.VANITY_LANE}`).address;
const both = async () => ({ ops: await lamports(ops), sim: await lamports(sim.address) });

/** The fake Phantom on the test admin key, then the console. */
async function open(page: Page) {
  const admin = adminAccount();
  await injectPhantom(page, admin);
  await preConsent(page, admin.address);
  await openConsole(page);
}

const firstAudit = (page: Page) =>
  page.getByRole("region", { name: "Audit log", exact: true }).getByRole("row").nth(1).getByRole("cell");

let coin: Coin;
let start: { ops: number; sim: number } | undefined;
let found: Settings | undefined; // the switches and evacuated_at before the run
let mark = "0";
const crafted: string[] = [];
test.beforeAll(async () => {
  const alone = "run admin-devnet alone: the E2E_DEVNET specs need FEE_ENGINE=on and live launches";
  expect(process.env.E2E_DEVNET, alone).not.toBe("1");
  expect((await fetch(`${WORKER}/healthz`)).ok, "a local worker on 8080").toBe(true);
  await preflight();
  found = await settings();
  coin = await pickCoin();
  start = await both();
  mark = await ledgerMark();
  console.log(
    `admin devnet: ${coin.symbol} ${coin.mint}; before: ops ${sol(start.ops)}, sim ${sol(start.sim)} SOL`,
  );
});

async function budget() {
  if (!start) return;
  const end = await both();
  const spend = start.ops + start.sim - end.ops - end.sim;
  console.log(`after: ops ${sol(end.ops)}, sim ${sol(end.sim)} SOL; run net spend ${sol(spend)} SOL`);
  expect(spend, "run net spend").toBeLessThanOrEqual(RUN_BUDGET_LAMPORTS);
}

// Each cleanup runs on its own, so a failed delete never skips the switch restore (WR-E-02).
test.afterAll(async () => {
  const errors: unknown[] = [];
  const step = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      errors.push(e);
    }
  };
  if (crafted.length) {
    await step(async () => db()`delete from launches where mint in ${db()(crafted)}`);
    await step(async () => db()`delete from vanity_mints where pubkey in ${db()(crafted)}`);
  }
  if (found) await step(() => restore(found as Settings));
  await step(budget);
  if (errors.length) throw errors[0];
});

test("Sweep now collects, splits and sweeps a real coin from the console", async ({ page }) => {
  const sigs = [...trade(coin.mint, "--buy", "0.01"), ...trade(coin.mint, "--sell")];
  console.log(`trades ${sigs.join(", ")}`);
  await open(page);
  await page.getByRole("button", { name: `${coin.symbol}, open timeline` }).click();
  const panel = page.getByRole("region", { name: `Timeline, ${coin.symbol}` });
  await panel.getByRole("button", { name: "Sweep now", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { level: 2 })).toHaveText(
    `Sweep now, ${coin.symbol}`,
  );
  console.log(`sweep now: ${(await signAndSend(page)).join(", ")}`);
  const cells = firstAudit(page);
  await expect(cells.nth(2)).toHaveText(`Sweep now: ${coin.symbol}`, { timeout: 30_000 });
  await expect(cells.nth(4)).toHaveText("Landed");
  // This run's rows, not the page: a reused coin already lists old Collect, Split and Sweep rows (CR-E-01).
  const rows = (await rowsAfter(mark)).filter((r) => r.mint === coin.mint && r.state === "landed");
  logRows(rows);
  for (const kind of ["collect", "split_treasury", "sweep_buyback"])
    expect(
      rows.some((r) => r.kind === kind),
      `${kind} row from this Sweep now`,
    ).toBe(true);
  const sweepSig = rows.find((r) => r.kind === "sweep_buyback")?.signature as string;
  const ledger = page.getByRole("region", { name: "Fee ledger" });
  await expect(async () => {
    await page.goto(`/coin/${coin.mint}`);
    await expect(ledger.locator(`a[href*="${sweepSig}"]`).first()).toBeVisible({ timeout: 5000 });
  }).toPass({ intervals: [5000], timeout: 60_000 });
});

test("Burn buyback now burns exactly the buyback's BONDR", async ({ page }) => {
  // Sweep now just filled the buyback, so an empty one is a failure, not a skip (WR-E-01).
  expect(env.VANITY_LANE, "VANITY_LANE in the root .env").toBeTruthy();
  const held = await tokens(buyback, Q);
  expect(held, "the buyback holds the BONDR Sweep now swept").toBeGreaterThan(0n);
  const before = await supply(Q);
  await open(page);
  await page
    .getByRole("region", { name: "Wallets" })
    .getByRole("button", { name: "Burn buyback now" })
    .click();
  console.log(`burn buyback ${held}: ${(await signAndSend(page)).join(", ")}`);
  await expect.poll(() => supply(Q), { timeout: 30_000 }).toBe(before - held);
  expect(await tokens(buyback, Q)).toBe(0n);
  const cells = firstAudit(page);
  await expect(cells.nth(2)).toHaveText("Burn buyback now", { timeout: 30_000 });
  await expect(cells.nth(4)).toHaveText("Landed");
});

test("Re-check launch on an unconfirmed launch says not on chain and changes nothing", async ({ page }) => {
  const mint = bs58.encode(randomBytes(32));
  crafted.push(mint);
  const [{ wallet }] = await db()`select wallet from launches where state = 'landed' limit 1`;
  const idx = -(2n ** 61n) - BigInt(randomInt(1_000_000_000));
  await db()`insert into vanity_mints (idx, pubkey, used_at) values (${idx.toString()}, ${mint}, now())`;
  await db()`insert into launches (id, wallet, mint, w, state, name, symbol, uri, sol_in, exit, signature, created_at)
    values (${randomBytes(16).toString("hex")}, ${wallet}, ${mint}, ${bs58.encode(randomBytes(32))}, 'unknown',
      'BONDR e2e recheck', 'RCHK', 'https://ipfs.io/ipfs/x', 2500000, 'burn', ${bs58.encode(randomBytes(64))}, now())`;
  await open(page);
  await page.getByRole("button", { name: "Refresh" }).click();
  const pick = page.getByRole("button", { name: "RCHK, open timeline" });
  await expect(page.getByRole("row").filter({ has: pick })).toContainText("Launch unconfirmed", {
    timeout: 30_000,
  });
  await pick.click();
  const panel = page.getByRole("region", { name: "Timeline, RCHK" });
  await panel.getByRole("button", { name: "Re-check launch" }).click();
  await expect(panel.getByText("The launch is not on chain yet. Nothing changed.")).toBeVisible({
    timeout: 30_000,
  });
  const [row] = await db()`select state from launches where mint = ${mint}`;
  expect(row?.state).toBe("unknown");
});

test("EVACUATE empties every dev W to the treasury and burn and pauses every switch", async ({ page }) => {
  const dev = (await db()<{ mint: string }[]>`select mint from coins`).map((r) => r.mint);
  const staging = await stagingMints(STAGING);
  const shared = dev.filter((m) => staging.has(m));
  console.log(`evacuate: ${dev.length} dev coins, ${staging.size} staging coins, ${shared.length} shared`);
  test.skip(shared.length > 0, "dev and staging share a coin; evacuating would move staging W funds");
  const seeded = await seedW(coin);
  console.log(
    `seeded ${coin.symbol} W: ${seeded.bondr} BONDR, ${seeded.child} ${coin.symbol}, ${seeded.sig}`,
  );
  expect(await fullW(), "EVACUATE would move only the W this run seeded").toEqual([coin.w]);
  const evacMark = await ledgerMark();

  await open(page);
  const box = page.getByRole("region", { name: "EVACUATE" });
  const input = box.getByLabel(`Type ${PHRASE} to arm`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(PHRASE);
  await expect(box.getByText(/^Simulated now:/)).toBeVisible({ timeout: 2 * 60_000 });
  console.log(await box.getByText(/^Simulated now:/).innerText());
  await box.getByRole("button", { name: "Connect Phantom" }).click();
  await box.getByRole("button", { name: "Sign and evacuate 1 wallet", exact: true }).click();
  const done = box.getByText(/^Evacuated\./);
  await expect(done).toHaveText(/^Evacuated\. (\d+) of \1 wallets moved to the treasury, 0 failed\./, {
    timeout: 5 * 60_000,
  });
  console.log(await done.innerText());

  const switches = page.getByRole("region", { name: "Kill switches", exact: true });
  for (const name of SWITCHES)
    await expect(switches.getByRole("switch", { name, exact: true })).toHaveAttribute(
      "aria-checked",
      "false",
      {
        timeout: 30_000,
      },
    );
  const [s] = await db()`select evacuated_at from settings`;
  expect(s?.evacuated_at).not.toBeNull();
  expect(await fullW(), "every derived W is empty").toEqual([]);
  const rows = (await rowsAfter(evacMark)).filter((r) => r.mint === coin.mint && r.state === "landed");
  logRows(rows);
  expect(rows.find((r) => r.kind === "evacuate")?.amount).toBe(seeded.bondr.toString());
  expect(rows.find((r) => r.kind === "leftover_burn")?.burned).toBe(seeded.child.toString());
});
