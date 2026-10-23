import type { CoinLive, CoinRow } from "@bondr/core/api";
import { expect, test } from "vitest";
import { applyBond, applyTrade, decay, insertLaunch, rerank, trendingMode, union } from "./live-list";

const NOW = Date.parse("2026-10-24T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function coin(mint: string, over: Partial<CoinRow> = {}): CoinRow {
  return {
    mint,
    venue: "curve",
    mcapSol: 28,
    progress: 0.1,
    vol1h: 0,
    vol24h: 0,
    change1h: null,
    lastTradeAt: null,
    bondSol: null,
    bondrAtBond: null,
    realQuoteReserves: "0",
    holders: null,
    name: mint,
    symbol: mint,
    imageCid: null,
    exit: "burn",
    launchedAt: ago(0),
    launchMcapSol: 28,
    bondSig: null,
    bondedAt: null,
    ...over,
  };
}
const mints = (l: CoinRow[]) => l.map((c) => c.mint);

test("applyTrade replaces the coin's live fields in place and ignores coins not listed", () => {
  const list = [coin("a"), coin("b")];
  const live: CoinLive = { ...coin("b"), mcapSol: 99, progress: 0.5, vol1h: 2, change1h: 0.1 };
  const next = applyTrade(list, { coin: live });
  expect(mints(next)).toEqual(["a", "b"]);
  expect(next[1]).toMatchObject({ mcapSol: 99, progress: 0.5, vol1h: 2, change1h: 0.1, name: "b" });
  expect(next[0]).toBe(list[0]);
  expect(applyTrade(list, { coin: { ...live, mint: "z" } })).toBe(list);
});

test("applyBond sets the venue and a full curve", () => {
  const list = [coin("a"), coin("b")];
  const next = applyBond(list, { mint: "a", venue: "complete", bondSig: "s", bondedAt: ago(0) });
  expect(next[0]).toMatchObject({ venue: "complete", progress: 1, bondSig: "s" });
  expect(next[1]).toBe(list[1]);
  expect(applyBond(list, { mint: "z", venue: "pool", bondSig: null, bondedAt: null })).toBe(list);
});

test("insertLaunch prepends only to Latest with no search, never twice", () => {
  const list = [coin("a")];
  const fresh = coin("n");
  expect(mints(insertLaunch(list, fresh, { sort: "latest", q: "" }))).toEqual(["n", "a"]);
  expect(insertLaunch(list, fresh, { sort: "top", q: "" })).toBe(list);
  expect(insertLaunch(list, fresh, { sort: "oldest", q: "" })).toBe(list);
  expect(insertLaunch(list, fresh, { sort: "latest", q: "gr" })).toBe(list);
  expect(insertLaunch(list, coin("a"), { sort: "latest", q: "" })).toBe(list);
});

test("decay zeroes 1h volume after an hour and 24h volume after a day, nothing else", () => {
  const list = [
    coin("recent", { vol1h: 1, vol24h: 2, lastTradeAt: ago(59 * 60_000) }),
    coin("hour", { vol1h: 1, vol24h: 2, lastTradeAt: ago(61 * 60_000), mcapSol: 50 }),
    coin("day", { vol1h: 1, vol24h: 2, lastTradeAt: ago(25 * 3_600_000) }),
  ];
  const [recent, hour, day] = decay(list, NOW);
  expect(recent).toEqual(list[0]);
  expect(hour).toEqual({ ...list[1], vol1h: 0 });
  expect(day).toEqual({ ...list[2], vol1h: 0, vol24h: 0 });
});

test("rerank: Top by market cap then newest; Latest and Oldest by launch; trending by volume", () => {
  const a = coin("a", { mcapSol: 10, launchedAt: ago(3000), vol24h: 5 });
  const b = coin("b", { mcapSol: 30, launchedAt: ago(2000), vol1h: 1 });
  const c = coin("c", { mcapSol: 10, launchedAt: ago(1000), vol1h: 2 });
  const list = [a, b, c];
  expect(mints(rerank(list, "top"))).toEqual(["b", "c", "a"]);
  expect(mints(rerank(list, "latest"))).toEqual(["c", "b", "a"]);
  expect(mints(rerank(list, "oldest"))).toEqual(["a", "b", "c"]);
  expect(mints(rerank(list, "trending"))).toEqual(["c", "b", "a"]);
  expect(mints(rerank([a, coin("d", { launchedAt: ago(500) })], "trending"))).toEqual(["a", "d"]);
  expect(mints(list)).toEqual(["a", "b", "c"]); // a copy, never the same array
});

test("trendingMode: 1h, else 24h, else latest", () => {
  expect(trendingMode([coin("a"), coin("b", { vol1h: 0.1, vol24h: 0.1 })])).toBe("1h");
  expect(trendingMode([coin("a", { vol24h: 3 })])).toBe("24h");
  expect(trendingMode([coin("a")])).toBe("latest");
  expect(trendingMode([])).toBe("latest");
});

test("union keeps the first list's copy of a coin", () => {
  const a = coin("a", { mcapSol: 1 });
  expect(union([a], [coin("a", { mcapSol: 2 }), coin("b")])).toEqual([a, coin("b")]);
});
