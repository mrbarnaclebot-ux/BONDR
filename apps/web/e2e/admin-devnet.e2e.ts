// The owner console's money path on real devnet (D-37, D-39; ADMIN-01, ADMIN-03, ADMIN-04, ADMIN-10, ADMIN-11),
// E2E_DEVNET=1 only. It needs a worker started by hand with ADMIN_WALLET set to the test admin address,
// ADMIN_EVACUATE=on, FEE_ENGINE=off and VANITY_THREADS=0 (the command is in apps/worker/README.md), and a web dev
// server with the same ADMIN_WALLET (playwright.config.ts starts one). Stop that worker after the run: local and
// staging share the devnet ops wallet (Pitfall 12). In order: Sweep now on a dev-DB curve coin after two real
// trades, Burn buyback now, Re-check launch on a crafted unconfirmed launch (nothing changes), then EVACUATE once
// no dev coin is a staging coin. afterAll turns every switch back on, clears settings.evacuated_at and fails when
// the run's net devnet spend (ops plus sim) passes 0.05 SOL.
import { randomBytes, randomInt } from "node:crypto";
import { expect, type Page, request, test } from "@playwright/test";
import {
  createAssociatedTokenAccountIdempotentInstruction as ataIx,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import postgres from "postgres";
import { openConsole } from "./admin.ts";
import { DEVNET_RPC, lamports, RUN_BUDGET_LAMPORTS, sol, supply, tokens, trade, WORKER } from "./devnet.ts";
import { adminAccount, adminSignIn, injectPhantom, preConsent, rootEnv, seedAccount } from "./phantom.ts";

const env = rootEnv();
const sql = env.DATABASE_URL
  ? postgres(env.DATABASE_URL, { max: 1, idle_timeout: 5, onnotice: () => {} })
  : undefined;
const db = () => sql as postgres.Sql;
const Q = env.BONDR_QUOTE_MINT as string;
const STAGING = "https://web-staging-72bad.up.railway.app";
const PHRASE = "EVACUATE ALL W TO TREASURY";
const SEND = "Sign with owner wallet and send";
const SWITCHES = ["Launches", "Forced bond", "Sweeps", "Finalize", "Buyback burn"];
const JOBS = ["launches", "forcedBond", "sweeps", "finalize", "buybackBurn"];

test.describe.configure({ mode: "serial", timeout: 25 * 60_000 });
test.skip(process.env.E2E_DEVNET !== "1" || !sql, "real devnet console money path: set E2E_DEVNET=1");

const ops = seedAccount("ops:devnet:main").address;
const sim = seedAccount("sim:devnet:dev");
const buyback = seedAccount(`buyback:devnet:${env.VANITY_LANE}`).address;
const both = async () => ({ ops: await lamports(ops), sim: await lamports(sim.address) });
const origin = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin });

type Coin = { mint: string; symbol: string; w: string };
const derived = (c: Coin) => seedAccount(`w:devnet:${c.mint}`).address === c.w;

/** A landed curve coin whose W derives from the seed and whose symbol is unique (the W table names rows by it). */
async function pickCoin(): Promise<Coin> {
  const rows = await db()<Coin[]>`select c.mint, l.symbol, l.w from coins c join launches l
    on l.id = c.launch_id where c.venue = 'curve' and l.state = 'landed' order by c.launched_at desc`;
  const unique = (c: Coin) => rows.filter((r) => r.symbol === c.symbol).length === 1;
  const ours = rows.filter((c) => derived(c) && unique(c));
  expect(ours.length, "a unique-symbol curve coin whose W derives from the seed").toBeGreaterThan(0);
  return ours[0] as Coin;
}

type Ledger = Record<"id" | "kind" | "mint" | "state" | "amount" | "burned" | "signature", string | null>;
const rowsAfter = (id: string) => db()<Ledger[]>`select id, kind, mint, state, amount, burned, signature
  from fee_ledger where id > ${id} order by id`;
const logRows = (rows: Ledger[]) =>
  console.log(
    rows.map((r) => `  ${r.kind} ${r.mint} ${r.state} ${r.amount ?? r.burned} ${r.signature}`).join("\n"),
  );

/** The fake Phantom on the test admin key, then the console. */
async function open(page: Page) {
  const admin = adminAccount();
  await injectPhantom(page, admin);
  await preConsent(page, admin.address);
  await openConsole(page);
}

const firstAudit = (page: Page) =>
  page.getByRole("region", { name: "Audit log", exact: true }).getByRole("row").nth(1).getByRole("cell");

/** The open dialog's real simulation, the admin key's signature, then every landed TxLink; returns the sigs. */
async function signAndSend(page: Page): Promise<string[]> {
  const d = page.getByRole("dialog");
  await expect(d.getByText("Destinations check passed:")).toBeVisible({ timeout: 2 * 60_000 });
  await d.getByRole("button", { name: "Connect Phantom" }).click();
  await d.getByRole("button", { name: SEND }).click();
  const sent = d.getByRole("status").filter({ hasText: "Sent." });
  await expect(sent).toHaveText(/Sent\. (\d+) of \1 transactions landed\./, { timeout: 5 * 60_000 });
  const total = Number(/Sent\. (\d+)/.exec(await sent.innerText())?.[1]);
  const links = d.getByRole("link", { name: /opens Solscan/ });
  await expect(links).toHaveCount(total);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  await d.getByRole("button", { name: "Done" }).click();
  return hrefs.map((h) => /\/tx\/(\w+)/.exec(h)?.[1] ?? h);
}

/** Every staging coin's mint from its public list, all pages (hidden coins are not listed). */
async function stagingMints(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 0; ; page++) {
    const res = await fetch(`${STAGING}/api/coins?sort=latest&page=${page}`);
    expect(res.ok, "staging /api/coins answers").toBe(true);
    const body = (await res.json()) as { coins: { mint: string }[]; more: boolean };
    for (const c of body.coins) out.add(c.mint);
    if (!body.more) return out;
  }
}

/** Every W is empty before EVACUATE, so the sim dev buys the coin and sends W some of it and 1 BONDR. */
async function seedW(c: Coin): Promise<{ bondr: bigint; child: bigint; sig: string }> {
  trade(c.mint, "--curve-buy", "1");
  const [bondr, child] = [1_000_000n, await tokens(sim.address, c.mint)];
  expect(child, "the sim dev holds the coin after the curve buy").toBeGreaterThan(0n);
  const payer = Keypair.fromSeed(Buffer.from(sim.key.export({ format: "jwk" }).d as string, "base64url"));
  const w = new PublicKey(c.w);
  const tx = new Transaction();
  for (const [mint, amount] of [
    [new PublicKey(Q), bondr],
    [new PublicKey(c.mint), child],
  ] as const) {
    const to = getAssociatedTokenAddressSync(mint, w, true, T22);
    const from = getAssociatedTokenAddressSync(mint, payer.publicKey, false, T22);
    tx.add(ataIx(payer.publicKey, to, w, mint, T22));
    tx.add(createTransferCheckedInstruction(from, mint, to, payer.publicKey, amount, 6, [], T22));
  }
  const conn = new Connection(DEVNET_RPC, "confirmed");
  const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });
  return { bondr, child, sig };
}

/** The switches back on through the console's own route (worker memory too), then the DB as the backstop. */
async function restore() {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    if ((await adminSignIn(api, adminAccount())).ok())
      for (const job of JOBS)
        await api.post("/api/admin/switch", { headers: origin(), data: { job, enabled: true } });
  } finally {
    await api.dispose();
  }
  await db()`update settings set launches_enabled = true, forced_bond_enabled = true, sweeps_enabled = true,
    finalize_enabled = true, buyback_burn_enabled = true, evacuated_at = null`;
  const [s] = await db()`select launches_enabled, forced_bond_enabled, sweeps_enabled, finalize_enabled,
    buyback_burn_enabled, evacuated_at from settings`;
  console.log(`settings after restore: ${JSON.stringify(s)}`);
  expect(s).toEqual({
    ...{ launches_enabled: true, forced_bond_enabled: true, sweeps_enabled: true },
    ...{ finalize_enabled: true, buyback_burn_enabled: true, evacuated_at: null },
  });
}

let coin: Coin;
let start: { ops: number; sim: number } | undefined;
let mark = "0";
const crafted: string[] = [];
test.beforeAll(async () => {
  expect((await fetch(`${WORKER}/healthz`)).ok, "a local worker on 8080").toBe(true);
  coin = await pickCoin();
  start = await both();
  mark =
    (await db()<{ id: string }[]>`select coalesce(max(id), 0)::text as id from fee_ledger`)[0]?.id ?? "0";
  console.log(
    `admin devnet: ${coin.symbol} ${coin.mint}; before: ops ${sol(start.ops)}, sim ${sol(start.sim)} SOL`,
  );
});
test.afterAll(async () => {
  try {
    if (crafted.length) {
      await db()`delete from launches where mint in ${db()(crafted)}`;
      await db()`delete from vanity_mints where pubkey in ${db()(crafted)}`;
    }
    await restore();
  } finally {
    if (start) {
      const end = await both();
      const spend = start.ops + start.sim - end.ops - end.sim;
      console.log(`after: ops ${sol(end.ops)}, sim ${sol(end.sim)} SOL; run net spend ${sol(spend)} SOL`);
      expect(spend, "run net spend").toBeLessThanOrEqual(RUN_BUDGET_LAMPORTS);
    }
  }
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
  logRows(await rowsAfter(mark));

  const items = page.getByRole("region", { name: "Fee ledger" }).getByRole("listitem");
  await expect(async () => {
    await page.goto(`/coin/${coin.mint}`);
    for (const tag of ["Collect", "Split 90/10", "Sweep"]) {
      const link = items.filter({ hasText: tag }).first().getByRole("link").first();
      await expect(link).toHaveAttribute("href", /^https:\/\/solscan\.io\/tx\//, { timeout: 5000 });
    }
  }).toPass({ intervals: [5000], timeout: 60_000 });
});

test("Burn buyback now burns exactly the buyback's BONDR", async ({ page }) => {
  const held = await tokens(buyback, Q);
  test.skip(held === 0n, "buyback empty");
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
  const staging = await stagingMints();
  const shared = dev.filter((m) => staging.has(m));
  console.log(`evacuate: ${dev.length} dev coins, ${staging.size} staging coins, ${shared.length} shared`);
  test.skip(shared.length > 0, "dev and staging share a coin; evacuating would move staging W funds");
  const seeded = await seedW(coin);
  console.log(
    `seeded ${coin.symbol} W: ${seeded.bondr} BONDR, ${seeded.child} ${coin.symbol}, ${seeded.sig}`,
  );
  const before = (await db()<{ id: string }[]>`select coalesce(max(id), 0)::text as id from fee_ledger`)[0]
    ?.id;

  await open(page);
  const box = page.getByRole("region", { name: "EVACUATE" });
  const input = box.getByLabel(`Type ${PHRASE} to arm`);
  await input.scrollIntoViewIfNeeded();
  await input.fill(PHRASE);
  await expect(box.getByText(/^Simulated now:/)).toBeVisible({ timeout: 2 * 60_000 });
  console.log(await box.getByText(/^Simulated now:/).innerText());
  await box.getByRole("button", { name: "Connect Phantom" }).click();
  await box.getByRole("button", { name: /^Sign and evacuate \d+ wallets?$/ }).click();
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
  const coins = await db()<
    Coin[]
  >`select c.mint, l.symbol, l.w from coins c join launches l on l.id = c.launch_id`;
  for (const c of coins.filter(derived)) {
    expect(await tokens(c.w, Q), `${c.symbol} W BONDR`).toBe(0n);
    expect(await tokens(c.w, c.mint), `${c.symbol} W child tokens`).toBe(0n);
  }
  const rows = (await rowsAfter(before ?? mark)).filter((r) => r.mint === coin.mint && r.state === "landed");
  logRows(rows);
  expect(rows.find((r) => r.kind === "evacuate")?.amount).toBe(seeded.bondr.toString());
  expect(rows.find((r) => r.kind === "leftover_burn")?.burned).toBe(seeded.child.toString());
});
