import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { bondrAtBond, curvePrice, mcapSol, poolPrice, progress, toSol } from "./price.ts";
import { type Bondr, type KnownCoin, parseTx, type TradeTx } from "./trades.ts";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const fixture = (name: string): TradeTx => load(name).response;
const sig = (name: string): string => load(name).source;

const DEV = "F9DVpqKqC3yFCZCLPYXdRMTxMkkMommj1ue1uXAPbndr"; // devnet burn coin, quoted in devnet BONDR
const FORK = "HJRK5jadiqXfRP7MC7CghE7nt3U862r9Q2iVe7qxa6JC"; // fork child, completed and migrated
const POOL = "3rTxmKGrJtDs62KoHj28FFX1jkEY9VUw2jeAqBA78VK7"; // FORK's PumpSwap pool
const INIT = 793_100_000_000_000n;
const devBondr = (sol: number | null): Bondr => ({
  mint: "4Jw2pr67qmpMi7DQGNZBwKF5Trgse5tNszLkpCnFEovA",
  pool: "unused-devnet-bondr-is-on-its-curve",
  sol,
});
const forkBondr: Bondr = { mint: "8rYqQsn5hDg7y3bS17dn6vcrFjKK1xB4YHJ8uy1pZ4MV", pool: "unused", sol: 3e-7 };
const coin = (mint: string, pool = "unused"): ReadonlyMap<string, KnownCoin> =>
  new Map([[mint, { mint, bondingCurve: "unused", pool, initialRealTokenReserves: String(INIT) }]]);
// BONDR price after each BONDR curve TradeEvent (lamports per BONDR base unit)
const px = (vQ: bigint, vT: bigint) => curvePrice(vQ, vT);

test("launch-burn: created coin, launch dev buy and a synthetic burn row", () => {
  const r = parseTx(fixture("launch-burn"), new Map(), devBondr(null), { mint: DEV, exit: "burn" });
  const p = px(315890677n, 1019023468424286n);
  expect(r.bondr).toBe(p);
  expect(r.created?.mint).toBe(DEV);
  expect(r.created?.initialRealTokenReserves).toBe(String(INIT));
  expect(r.created?.launchMcapSol).toBe(mcapSol(curvePrice(264838886172211n, 1073000000000000n), p));
  expect(r.created?.mcapSol).toBe(mcapSol(curvePrice(272549639740058n, 1042643553423183n), p));
  const [buy, burn, ...rest] = r.trades;
  expect(rest).toEqual([]);
  expect(buy).toMatchObject({
    ix: 2,
    side: "buy",
    launch: true,
    venue: "curve",
    sol: String(toSol(7710753567847n, p)),
  });
  expect(buy?.trader).toBe("9Hm1YEfXqR2WD78rLHBM6nhnEB9tTURcwxtpU9TjwQM6");
  expect(burn).toMatchObject({
    ix: 1000,
    side: "burn",
    launch: true,
    sol: null,
    quoteAmount: null,
    mcapSol: null,
  });
  expect(burn?.tokenAmount).toBe(buy?.tokenAmount);
  expect(burn?.trader).toBe(buy?.trader);
});

test("launch-sell: dev buy and child sell, each valued at the nearest BONDR event", () => {
  const mint = "GoJKjYdyaGwNs82NrMM2xRJm19U5ZRLkx16Rbcjpbndr";
  const r = parseTx(fixture("launch-sell"), new Map(), devBondr(null), { mint, exit: "sell" });
  expect(r.trades.map((t) => [t.ix, t.side, t.launch])).toEqual([
    [2, "buy", true],
    [3, "sell", true],
  ]);
  expect(r.trades[0]?.sol).toBe(String(toSol(7591172985317n, px(318359812n, 1011120129479647n))));
  expect(r.trades[1]?.sol).toBe(String(toSol(7591172985316n, px(315994542n, 1018688528946007n))));
  expect(r.bondr).toBe(px(315994542n, 1018688528946007n));
});

test("curve-buy on a known coin: one row priced by the bondr argument and a full curve patch", () => {
  const r = parseTx(fixture("curve-buy"), coin(DEV), devBondr(3e-7));
  const [vQ, vT, realT, realQ] = [273537294061047n, 1038878906213663n, 758978906213663n, 8698407888836n];
  const mcap = mcapSol(curvePrice(vQ, vT), 3e-7);
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({
    signature: sig("curve-buy"),
    side: "buy",
    launch: false,
    venue: "curve",
  });
  expect(r.trades[0]).toMatchObject({ quoteAmount: "987654320987", sol: String(toSol(987654320987n, 3e-7)) });
  expect(r.trades[0]).toMatchObject({ bondrSol: 3e-7, mcapSol: mcap, slot: "514267874" });
  expect(r.trades[0]?.at).toBe(new Date(1792763649 * 1000).toISOString());
  const atBond = bondrAtBond(vQ, vT, realT, realQ);
  expect(r.patches).toEqual([
    {
      mint: DEV,
      realTokenReserves: String(realT),
      realQuoteReserves: String(realQ),
      virtualTokenReserves: String(vT),
      virtualQuoteReserves: String(vQ),
      mcapSol: mcap,
      progress: progress(realT, INIT),
      bondrAtBond: String(atBond),
      bondSol: Number(toSol(atBond, 3e-7)) / 1e9,
    },
  ]);
  expect(r.bondr).toBeNull();
});

test("curve-sell and multihop-sell are sell rows", () => {
  for (const f of ["curve-sell", "multihop-sell"])
    expect(parseTx(fixture(f), coin(DEV), devBondr(3e-7)).trades.map((t) => t.side)).toEqual(["sell"]);
});

test("multihop-buy: the child row uses the same-tx BONDR price, not the argument", () => {
  const r = parseTx(fixture("multihop-buy"), coin(DEV), devBondr(1));
  const p = px(325900436n, 987725024500036n);
  expect(r.bondr).toBe(p);
  expect(r.trades).toHaveLength(1);
  expect(r.trades[0]).toMatchObject({ ix: 1, bondrSol: p, sol: String(toSol(30870891770659n, p)) });
});

test("bondr-buy: no rows, only the BONDR price", () => {
  const r = parseTx(fixture("bondr-buy"), coin(DEV), devBondr(null));
  expect(r).toMatchObject({ trades: [], patches: [], created: null, unknown: [] });
  expect(r.bondr).toBe(px(320990281n, 1002834155267756n));
});

test("pool-buy and pool-sell: pool rows priced from the pool's post-trade token balances", () => {
  for (const [f, side, base, quote, virt, tokens, q] of [
    [
      "pool-buy",
      "buy",
      181113419818657n,
      112308024204437n,
      24739279326487n,
      "8007618534084",
      "5798517076451",
    ],
    [
      "pool-sell",
      "sell",
      189121038352741n,
      106609048985112n,
      24650851941070n,
      "8007618534084",
      "5799008109211",
    ],
  ] as const) {
    const r = parseTx(fixture(f), coin(FORK, POOL), forkBondr);
    const mcap = mcapSol(poolPrice(quote + virt, base), 3e-7);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0]).toMatchObject({
      mint: FORK,
      side,
      venue: "pool",
      tokenAmount: tokens,
      quoteAmount: q,
    });
    expect(r.trades[0]?.mcapSol).toBe(mcap);
    expect(r.patches).toEqual([{ mint: FORK, mcapSol: mcap }]);
  }
});

test("a BONDR/SOL pool event sets the BONDR price", () => {
  const r = parseTx(fixture("pool-buy"), new Map(), { mint: FORK, pool: POOL, sol: null });
  expect(r.bondr).toBe(poolPrice(112308024204437n + 24739279326487n, 181113419818657n));
  expect(r.trades).toEqual([]);
});

test("complete: completing curve buy, PostCompleteBuyEvent pool buy, venue complete with bond facts", () => {
  const r = parseTx(fixture("complete"), coin(FORK), forkBondr);
  expect(r.trades.map((t) => [t.ix, t.side, t.venue, t.tokenAmount])).toEqual([
    [0, "buy", "curve", "793100000000000"],
    [2, "buy", "pool", "11711320754713"],
  ]);
  expect(r.trades[1]?.mcapSol).toBe(mcapSol(poolPrice(127063968020878n, 195188679245287n), 3e-7));
  expect(r.patches).toHaveLength(1);
  expect(r.patches[0]).toMatchObject({
    mint: FORK,
    venue: "complete",
    progress: 1,
    bondSig: sig("complete"),
  });
  expect(r.patches[0]?.bondedAt).toBe(new Date(1792763789 * 1000).toISOString());
});

test("create-pool: venue pool, and the events parseTx does not use are listed as unknown", () => {
  const r = parseTx(fixture("create-pool"), coin(FORK, POOL), forkBondr);
  expect(r.patches).toEqual([{ mint: FORK, venue: "pool" }]);
  expect(r.trades).toEqual([]);
  expect(r.unknown).toEqual(["InitBoostEvent", "CompletePumpAmmMigrationEvent"]);
});

test("coins BONDR did not launch are ignored (D-03)", () => {
  for (const f of ["curve-buy", "create-pool", "pool-buy"]) {
    const r = parseTx(fixture(f), new Map(), devBondr(3e-7));
    expect(r).toMatchObject({ trades: [], patches: [], created: null, unknown: [] });
  }
});

test("parsing is deterministic, so (signature, ix) keys are idempotent", () => {
  for (const f of ["launch-burn", "launch-sell", "multihop-buy", "complete", "pool-sell"]) {
    const launch = f.startsWith("launch") ? { mint: load(f).mint, exit: "burn" as const } : undefined;
    const run = () => parseTx(fixture(f), coin(load(f).mint, POOL), forkBondr, launch);
    expect(run()).toEqual(run());
  }
});
