// admin-devnet.e2e.ts's helpers, split out to keep the spec under 300 lines: the dev DB, the coin pick, ledger
// rows, the dialog's sign and send, the preflight that fails before any spend, the W seeding and the guard that
// keeps EVACUATE to the one W this run seeded, and the settings snapshot and restore.
import { windowOf } from "@bondr/core/fees";
import { expect, type Page, request, test } from "@playwright/test";
import {
  createAssociatedTokenAccountIdempotentInstruction as ataIx,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as T22,
} from "@solana/spl-token";
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import postgres from "postgres";
import { DEVNET_RPC, lamports, tokens, trade } from "./devnet.ts";
import { adminAccount, adminSignIn, rootEnv, seedAccount } from "./phantom.ts";

export const env = rootEnv();
const sql = env.DATABASE_URL
  ? postgres(env.DATABASE_URL, { max: 1, idle_timeout: 5, onnotice: () => {} })
  : undefined;
export const hasDb = sql !== undefined;
export const db = () => sql as postgres.Sql;
export const Q = env.BONDR_QUOTE_MINT as string;
export const sim = seedAccount("sim:devnet:dev");
export const origin = () => ({ origin: new URL(test.info().project.use.baseURL as string).origin });

export type Coin = { mint: string; symbol: string; w: string };
export const derived = (c: Coin) => seedAccount(`w:devnet:${c.mint}`).address === c.w;

/** A landed curve coin whose W derives from the seed and whose symbol is unique (the W table names rows by it).
 * Sweep now is the current window's sweep, and fee_ledger_sweep allows one per window, so a coin already swept
 * in its current window (the worker's FEE_WINDOW_MS, 24 h unset) would collect and split but never sweep. */
export async function pickCoin(): Promise<Coin> {
  const rows = await db()<(Coin & { launched_at: Date; swept: number[] })[]>`
    select c.mint, l.symbol, l.w, c.launched_at, coalesce(array_agg(f.window_index)
      filter (where f.window_index is not null), '{}') as swept
    from coins c join launches l on l.id = c.launch_id
    left join fee_ledger f on f.mint = c.mint and f.kind = 'sweep_buyback' and f.state in ('pending', 'landed')
    where c.venue = 'curve' and l.state = 'landed' group by c.mint, l.symbol, l.w, c.launched_at
    order by c.launched_at desc`;
  const windowMs = Number(process.env.FEE_WINDOW_MS ?? 86_400_000);
  const unique = (c: Coin) => rows.filter((r) => r.symbol === c.symbol).length === 1;
  const fresh = (r: (typeof rows)[number]) =>
    !r.swept.includes(windowOf(+r.launched_at, Date.now(), windowMs));
  const ours = rows.filter((c) => derived(c) && unique(c) && fresh(c));
  expect(ours.length, "a unique-symbol curve coin, W from the seed, not swept this window").toBeGreaterThan(
    0,
  );
  const { mint, symbol, w } = ours[0] as Coin;
  return { mint, symbol, w };
}

export type Ledger = Record<
  "id" | "kind" | "mint" | "state" | "amount" | "burned" | "signature",
  string | null
>;
export const ledgerMark = async () =>
  (await db()<{ id: string }[]>`select coalesce(max(id), 0)::text as id from fee_ledger`)[0]?.id ?? "0";
export const rowsAfter = (id: string) => db()<
  Ledger[]
>`select id, kind, mint, state, amount, burned, signature
  from fee_ledger where id > ${id} order by id`;
export const logRows = (rows: Ledger[]) =>
  console.log(
    rows.map((r) => `  ${r.kind} ${r.mint} ${r.state} ${r.amount ?? r.burned} ${r.signature}`).join("\n"),
  );

/** The open dialog's real simulation, the admin key's signature, then every landed TxLink; returns the sigs. */
export async function signAndSend(page: Page): Promise<string[]> {
  const d = page.getByRole("dialog");
  await expect(d.getByText("Destinations check passed:")).toBeVisible({ timeout: 2 * 60_000 });
  await d.getByRole("button", { name: "Connect Phantom" }).click();
  await d.getByRole("button", { name: "Sign with owner wallet and send" }).click();
  const sent = d.getByRole("status").filter({ hasText: "Sent." });
  await expect(sent).toHaveText(/Sent\. (\d+) of \1 transactions landed\./, { timeout: 5 * 60_000 });
  const total = Number(/Sent\. (\d+)/.exec(await sent.innerText())?.[1]);
  const links = d.getByRole("link", { name: /opens Solscan/ });
  await expect(links).toHaveCount(total);
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  await d.getByRole("button", { name: "Done" }).click();
  return hrefs.map((h) => /\/tx\/(\w+)/.exec(h)?.[1] ?? h);
}

/** Fails, never skips, before any SOL moves: the web server takes the test admin and the worker runs the flags. */
export async function preflight() {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    const signedIn = (await adminSignIn(api, adminAccount())).status();
    expect(signedIn, "web server has the test ADMIN_WALLET and SITE_URL").toBe(200);
    const h = await (await api.post("/api/admin/health", { headers: origin(), data: {} })).json();
    expect(h.evacuate, "worker started with ADMIN_EVACUATE=on").toBe("on");
    expect(h.feeEngine, "worker started with FEE_ENGINE=off").not.toBe("on");
  } finally {
    await api.dispose();
  }
}

/** Every staging coin's mint from its public list, all pages (hidden coins are not listed: see `fullW`). */
export async function stagingMints(staging: string): Promise<Set<string>> {
  const out = new Set<string>();
  for (let page = 0; ; page++) {
    const res = await fetch(`${staging}/api/coins?sort=latest&page=${page}`);
    expect(res.ok, "staging /api/coins answers").toBe(true);
    const body = (await res.json()) as { coins: { mint: string }[]; more: boolean };
    for (const c of body.coins) out.add(c.mint);
    if (!body.more) return out;
  }
}

/**
 * Every derived dev W that EVACUATE would move (evacuateBalances' rule: any SOL, BONDR or child token). The
 * guard before arming wants exactly the W this run seeded: any other may be a staging fixture whose coin is
 * hidden there, which the public list cannot show (WR-E-05).
 */
export async function fullW(): Promise<string[]> {
  const coins = await db()<
    Coin[]
  >`select c.mint, l.symbol, l.w from coins c join launches l on l.id = c.launch_id`;
  const out: string[] = [];
  for (const c of coins.filter(derived))
    if ((await lamports(c.w)) || (await tokens(c.w, Q)) || (await tokens(c.w, c.mint))) out.push(c.w);
  return out;
}

/** Every W is empty before EVACUATE, so the sim dev buys the coin and sends W some of it and 1 BONDR. */
export async function seedW(c: Coin): Promise<{ bondr: bigint; child: bigint; sig: string }> {
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

const COLS = {
  ...{ launches: "launches_enabled", forcedBond: "forced_bond_enabled", sweeps: "sweeps_enabled" },
  ...{ finalize: "finalize_enabled", buybackBurn: "buyback_burn_enabled" },
} as const;
export type Settings = Record<(typeof COLS)[keyof typeof COLS], boolean> & { evacuated_at: Date | null };
export const settings = async () =>
  (
    await db()<Settings[]>`select launches_enabled, forced_bond_enabled, sweeps_enabled, finalize_enabled,
    buyback_burn_enabled, evacuated_at from settings`
  )[0] as Settings;

/**
 * The run's starting switches back through the console's own route (worker memory too), each answer checked,
 * then the DB as the backstop even when sign-in failed. Restores the snapshot, so a job the owner had paused on
 * purpose stays paused (WR-E-02).
 */
export async function restore(b: Settings) {
  const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await adminSignIn(api, adminAccount())).status(), "afterAll sign-in to restore switches").toBe(
      200,
    );
    for (const [job, col] of Object.entries(COLS)) {
      const r = await api.post("/api/admin/switch", { headers: origin(), data: { job, enabled: b[col] } });
      expect(r.status(), `switch ${job} back to ${b[col]}`).toBe(200);
    }
  } finally {
    await api.dispose();
    await db()`update settings set launches_enabled = ${b.launches_enabled},
      forced_bond_enabled = ${b.forced_bond_enabled}, sweeps_enabled = ${b.sweeps_enabled},
      finalize_enabled = ${b.finalize_enabled}, buyback_burn_enabled = ${b.buyback_burn_enabled},
      evacuated_at = ${b.evacuated_at}`;
    const s = await settings();
    console.log(`settings after restore: ${JSON.stringify(s)}`);
    expect(s).toEqual(b);
  }
}
