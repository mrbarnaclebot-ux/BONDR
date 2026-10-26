// The fee engine on real devnet (D-25; FEE-01, FEE-04, FEE-06, FEE-08, FEE-09, TOKEN-04), E2E_DEVNET=1 only. It
// needs a worker started by hand with FEE_ENGINE=on FEE_WINDOW_MS=600000 VANITY_THREADS=0 (stop it after the run:
// local and staging share the devnet ops wallet, Pitfall 11) and a web dev server with FEE_WINDOW_MS=600000.
// Two real trades on a dev-DB curve coin whose W derives from the seed, then its next window end collects, splits
// and sweeps with no manual help; the page shows each row with its Solscan link. A bearer POST /fee/batch then
// burns the buyback's BONDR (the supply drops by exactly that) and reconciles with no diff. Ops pays every fee;
// the run's net devnet spend (ops plus sim) is printed and capped at 0.05 SOL. Nothing is seeded.
import { sweepSplit, windowEnd, windowOf } from "@bondr/core/fees";
import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";
import { lamports, RUN_BUDGET_LAMPORTS, sol, supply, tokens, trade, WORKER } from "./devnet.ts";
import { rootEnv, seedAccount } from "./phantom.ts";

const env = rootEnv();
const sql = env.DATABASE_URL
  ? postgres(env.DATABASE_URL, { max: 1, idle_timeout: 5, onnotice: () => {} })
  : undefined;
const db = () => sql as postgres.Sql;
const WINDOW_MS = Number(process.env.FEE_WINDOW_MS ?? 600_000);
const Q = env.BONDR_QUOTE_MINT as string;
const bondr = (owner: string) => tokens(owner, Q);

test.describe.configure({ mode: "serial", timeout: 20 * 60_000 });
const devnet = process.env.E2E_DEVNET === "1" && !!sql;
test.skip(!devnet, "real devnet fee movements: set E2E_DEVNET=1");

// Derived only when the group runs: Playwright loads every file even under --grep, and CI has no seed.
const addr = (id: string) => (devnet ? seedAccount(id).address : "");
const ops = addr("ops:devnet:main");
const sim = addr("sim:devnet:dev");
const buyback = addr(`buyback:devnet:${env.VANITY_LANE}`);
const both = async () => ({ ops: await lamports(ops), sim: await lamports(sim) });

type Coin = { mint: string; symbol: string; w: string; launchedAt: number };
const nextEnd = (launchedAt: number, after: number) =>
  windowEnd(launchedAt, windowOf(launchedAt, after, WINDOW_MS), WINDOW_MS);

/** The engine signs only for coins whose W derives from the seed; of those, the window that closes soonest but
 * at least 4 minutes out, so both trades are indexed before it fires. */
async function pickCoin(): Promise<Coin> {
  const rows = await db()<{ mint: string; symbol: string; w: string; launched_at: Date }[]>`
    select c.mint, l.symbol, l.w, c.launched_at from coins c join launches l on l.id = c.launch_id
    where c.venue = 'curve' and l.state = 'landed'`;
  const ours = rows
    .filter((r) => seedAccount(`w:devnet:${r.mint}`).address === r.w)
    .map((r) => ({ mint: r.mint, symbol: r.symbol, w: r.w, launchedAt: +r.launched_at }));
  expect(ours.length, "a curve coin whose W derives from the seed").toBeGreaterThan(0);
  const at = (c: Coin) => nextEnd(c.launchedAt, Date.now() + 4 * 60_000);
  return ours.sort((a, b) => at(a) - at(b))[0] as Coin;
}

type Row = {
  id: string;
  kind: string;
  mint: string | null;
  state: string | null;
  amount: string | null;
  burned: string | null;
  signature: string | null;
  ref: string | null;
};
const rowsAfter = (id: string) => db()<Row[]>`select id, kind, mint, state, amount, burned, signature, ref
  from fee_ledger where id > ${id} order by id`;
const big = (v: string | null) => BigInt(v ?? 0);
const sum = (rows: Row[]) => rows.reduce((s, r) => s + big(r.amount), 0n);

/** Reloads the token page every 30 s until the ledger shows a Collect, a Split and a Sweep with Solscan links. */
async function waitForLedger(page: Page, mint: string, until: number) {
  const items = page
    .getByRole("region", { name: "Fee ledger" })
    .getByRole("list", { name: "Fee movements, newest first" })
    .getByRole("listitem");
  await expect(async () => {
    await page.goto(`/coin/${mint}`);
    for (const tag of ["Collect", "Split 90/10", "Sweep"]) {
      const link = items.filter({ hasText: tag }).first().getByRole("link").first();
      await expect(link).toHaveAttribute("href", /^https:\/\/solscan\.io\/tx\//, { timeout: 5000 });
    }
  }).toPass({ intervals: [30_000], timeout: until - Date.now() });
}

let coin: Coin;
let start: { ops: number; sim: number };
let mark = "0";
test.beforeAll(async () => {
  expect((await fetch(`${WORKER}/healthz`)).ok, "a local worker on 8080").toBe(true);
  coin = await pickCoin();
  start = await both();
  mark =
    (await db()<{ id: string }[]>`select coalesce(max(id), 0)::text as id from fee_ledger`)[0]?.id ?? "0";
  console.log(
    `fee devnet: ${coin.symbol} ${coin.mint}; before: ops ${sol(start.ops)}, sim ${sol(start.sim)} SOL`,
  );
});
test.afterAll(async () => {
  if (!start) return;
  const end = await both();
  const spend = start.ops + start.sim - end.ops - end.sim;
  console.log(
    `fee devnet after: ops ${sol(end.ops)}, sim ${sol(end.sim)} SOL; run net spend ${sol(spend)} SOL`,
  );
  expect(spend, "run net spend").toBeLessThanOrEqual(RUN_BUDGET_LAMPORTS);
});

test("trades' fees are collected, split 90/10 and swept 90/10 at the window end", async ({ page }) => {
  const wBefore = await bondr(coin.w);
  const t0 = Date.now();
  const sigs = [...trade(coin.mint, "--buy", "0.01"), ...trade(coin.mint, "--sell")];
  const end = nextEnd(coin.launchedAt, Date.now());
  console.log(
    `trades ${sigs.join(", ")} in ${((Date.now() - t0) / 1000).toFixed(0)} s; window ends ${new Date(end).toISOString()}`,
  );
  await waitForLedger(page, coin.mint, end + WINDOW_MS + 2 * 60_000);
  console.log(`ledger rows on the page ${((Date.now() - end) / 1000).toFixed(0)} s after the window end`);

  const rows = (await rowsAfter(mark)).filter((r) => r.mint === coin.mint && r.state === "landed");
  for (const r of rows) console.log(`${r.kind} ${r.amount} ${r.signature}`);
  const sweep = rows.find((r) => r.kind === "sweep_buyback") as Row;
  const prior = rows.filter((r) => BigInt(r.id) < BigInt(sweep.id));
  const collects = prior.filter((r) => r.kind === "collect");
  const splits = prior.filter((r) => r.kind === "split_treasury");
  expect(splits.length).toBe(collects.length);
  for (const s of splits)
    expect(big(s.amount)).toBe(big(collects.find((c) => c.id === s.ref)?.amount ?? null) / 10n);
  const pair = rows.filter((r) => r.signature === sweep.signature);
  const swept = {
    buyback: sum(pair.filter((r) => r.kind === "sweep_buyback")),
    treasury: sum(pair.filter((r) => r.kind === "sweep_treasury")),
  };
  expect(swept).toEqual(sweepSplit(wBefore + sum(collects) - sum(splits)));
});

test("a bearer batch burns the buyback's BONDR and reconciles with no diff", async ({ request }) => {
  const [supplyBefore, held] = [await supply(Q), await bondr(buyback)];
  expect(held, "the buyback holds swept BONDR").toBeGreaterThan(0n);
  const batchMark = (await rowsAfter(mark)).at(-1)?.id ?? mark;
  const res = await request.post(`${WORKER}/fee/batch`, {
    headers: { authorization: `Bearer ${env.WORKER_TOKEN}` },
    timeout: 5 * 60_000,
  });
  expect(res.status()).toBe(200);
  const summary = (await res.json()) as { burn: string; diffs: number };
  console.log(`fee batch: ${JSON.stringify(summary)}`);
  expect(summary.burn).toBe("landed");

  const rows = await rowsAfter(batchMark);
  const burns = rows.filter((r) => r.kind === "buyback_burn" && r.state === "landed");
  expect(burns).toHaveLength(1);
  const burned = big((burns[0] as Row).burned);
  console.log(`buyback_burn ${burned} ${(burns[0] as Row).signature}`);
  expect(burned).toBe(held);
  await expect.poll(() => supply(Q), { timeout: 30_000 }).toBe(supplyBefore - burned);
  expect(await bondr(buyback)).toBe(0n);
  const diffs = rows.filter((r) => r.kind === "reconcile_diff" && (r.mint === coin.mint || r.mint === null));
  expect(diffs).toEqual([]);
});
