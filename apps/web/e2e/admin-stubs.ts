// Stubbed simulation dialog routes for admin-sim.e2e.ts (T-06-18-04): one page.route answers every
// /api/admin/simulate, /api/admin/execute and /api/admin/intent call in the browser, so no spec reaches the
// worker or spends devnet SOL: the route never falls through to the server. Also the console fixture: the real
// overview answer with one held finalize coin and a buyback balance, and the coin op from a fixture.
import type { AdminCoinMemory, AdminInspect, AdminSimResult } from "@bondr/core/api-admin";
import type { Page, Route } from "@playwright/test";
import type { WRow } from "../lib/admin-data.ts";
import type { CoinTimeline } from "../lib/admin-timeline.ts";

export const INTENT_ID = "b".repeat(32);
export const SIGS = ["5".repeat(88), "4".repeat(88)];
export const HELD_MINT = "Held111111111111111111111111111111111bndr";
const DEPLOYER = "Dep1oyer11111111111111111111111111111111111";

/** The worker's intent text around `fields` (admin-intent.ts intentMessage shape, WR-B-03 domain line). */
export const intentText = (fields: string[]): string =>
  [
    "127.0.0.1:3000 wants you to sign in with your Solana account:",
    "Owner11111111111111111111111111111111111111",
    "",
    "BONDR admin action. This is not a transaction. The BONDR worker checks it before sending.",
    "",
    "URI: http://127.0.0.1:3000",
    ...fields,
  ].join("\n");

/** A finalize_split intent; the spec compares the signed bytes to it. */
export const MESSAGE = intentText([
  "Action: finalize_split",
  `Coin: ${HELD_MINT}`,
  `Intent: ${INTENT_ID}`,
  `Destinations: Deployer ${DEPLOYER}, Treasury Trea5ury1111111111111111111111111111111111`,
  "Expiration Time: 2026-10-25T18:30:00.000Z",
]);

/** A two-step finalize_split with an intent unless `over` says otherwise. */
export function simFixture(over: Partial<AdminSimResult> = {}): AdminSimResult {
  return {
    ...{ action: "finalize_split", mint: HELD_MINT, ok: true, cu: 48_210, feeLamports: "15000" },
    steps: [
      { ok: true, cu: 30_000, estimated: false },
      { ok: true, cu: 18_210, estimated: true },
    ],
    balances: [
      { name: "Ops wallet", before: "1.2", after: "1.199985", change: "−0.000015", unit: "SOL" },
      { name: "Deployer Dep1…1111", before: "0", after: "0.4", change: "+0.4", unit: "SOL" },
    ],
    destinations: { ok: true, passed: ["deployer matches the launch signer", "treasury matches config"] },
    nothing: false,
    intent: { id: INTENT_ID, message: MESSAGE, expiresAt: Date.now() + 120_000 },
    ...over,
  };
}

export type SimReply = { status?: number; json: unknown };
export type SimStubs = { simulate?: SimReply; execute?: SimReply; intent?: (n: number) => SimReply };
export type SimCalls = { simulate: unknown[]; execute: unknown[]; intent: unknown[] };

const landed = { id: INTENT_ID, state: "landed", sigs: SIGS, landed: 2, total: 2 };

// Default: the fixture, a 202 execute, then "sending" once and "landed" with two signatures.
const answer = (o: SimStubs, op: keyof SimCalls, n: number): SimReply => {
  if (op === "simulate") return o.simulate ?? { json: simFixture() };
  if (op === "execute") return o.execute ?? { status: 202, json: { id: INTENT_ID } };
  return o.intent?.(n) ?? { json: n === 1 ? { ...landed, state: "sending", sigs: [], landed: 0 } : landed };
};

export async function stubSim(page: Page, o: SimStubs = {}): Promise<SimCalls> {
  const calls: SimCalls = { simulate: [], execute: [], intent: [] };
  await page.route(/\/api\/admin\/(simulate|execute|intent)$/, async (route: Route) => {
    const op = new URL(route.request().url()).pathname.split("/").pop() as keyof SimCalls;
    calls[op].push(route.request().postDataJSON());
    const r = answer(o, op, calls[op].length);
    // Dev StrictMode aborts the first simulate; fulfilling an aborted request throws, which is fine here.
    await route.fulfill({ status: r.status ?? 200, json: r.json }).catch(() => {});
  });
  return calls;
}

const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const ROW: WRow = {
  ...{ mint: HELD_MINT, symbol: "HELD", name: "HELD coin", image: null, w: DEPLOYER, venue: "pool" },
  ...{ finalize: "held", feeBudget: "100", feesUnclaimed: "0", cost: "1000", bondrSol: 0.001 },
  ...{ launchedAt: iso(5 * 3_600_000), lastCollectAt: iso(3_600_000), heldAt: iso(60_000) },
  ...{ heldReason: "finalize deployer check", bondSent: true, bondedAt: iso(3_600_000), launch: "landed" },
};
const MEMORY: AdminCoinMemory[] = [
  { mint: HELD_MINT, stuck: null, hold: "finalize deployer check", busy: false },
];
const BALANCES = {
  ...{ treasurySol: "0", treasuryBondr: "0", buybackSol: "0", buybackBondr: "5000000", opsSol: "1000000000" },
  ...{ opsFloor: "100000000", bondrSol: null, nextBurnAt: Date.now() + 3_600_000 },
};
const TIMELINE: CoinTimeline = {
  launch: {
    ...{ state: "landed", exit: "burn", solIn: "500000000", signature: "HeldLaunchSig", wallet: DEPLOYER },
    ...{ tokens: null, landedAt: null, createdAt: iso(5 * 3_600_000) },
  },
  rows: [],
};

/** The overview's rows and worker memory replaced (no DB writes), and the coin op answered from the fixture. */
export async function stubConsole(page: Page): Promise<void> {
  await page.route("**/api/admin/overview", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.rows = [ROW];
    body.worker = { balances: BALANCES, coins: MEMORY };
    await route.fulfill({ response: res, json: body });
  });
  await page.route("**/api/admin/coin", (route) =>
    route.fulfill({ json: { timeline: TIMELINE, live: null } }),
  );
}

/** A decoded curve buy for the inspector's output state (admin-responsive.e2e.ts). */
export const INSPECT: AdminInspect = {
  ...{ found: true, status: "success", slot: 514_267_874, error: null },
  feePayer: { label: "Ops wallet", address: DEPLOYER },
  instructions: [
    { index: 1, program: "Compute Budget", name: "SetComputeUnitLimit", args: ["units 200,000"] },
    { index: 2, program: "pump", name: "buy", args: ["amount 31,120,363,129,478", "max_sol_cost 0.0105"] },
  ],
  explorer: `https://solscan.io/tx/${SIGS[0]}?cluster=devnet`,
};

/**
 * A passing 12-wallet EVACUATE simulation with an intent (admin-responsive.e2e.ts). Built per call: a worker
 * keeps this module across files, so a load-time expiry could already have passed (WR-E-06).
 */
export const evacFixture = (): AdminSimResult =>
  simFixture({
    ...{ action: "evacuate", mint: null, balances: [], steps: [{ ok: true, cu: 180_000, estimated: false }] },
    totals: {
      wallets: 12,
      bondr: "18402110000000",
      bondrSol: "9200000000",
      sol: "410000000",
      burnedIn: 3,
      failures: 0,
    },
    destinations: { ok: true, passed: ["treasury matches config"] },
    intent: { id: INTENT_ID, message: "BONDR admin action", expiresAt: Date.now() + 600_000 },
  });
