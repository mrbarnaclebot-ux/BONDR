import type { CoinLive, CoinRow } from "@bondr/core/api";
import { expect, test } from "vitest";
import {
  addTrades,
  applyBond,
  applyTrade,
  decay,
  insertLaunch,
  mergePage,
  rerank,
  resyncFeed,
  trendingMode,
  union,
} from "./live-list";

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

test("mergePage keeps a local copy with a newer trade and local launches the kept page missed", () => {
  const live = coin("a", { mcapSol: 900, lastTradeAt: ago(1000), launchedAt: ago(2000) });
  const snap = [
    coin("a", { mcapSol: 860, lastTradeAt: ago(9000), launchedAt: ago(2000) }),
    coin("b", { launchedAt: ago(5000) }),
  ];
  const launch = coin("n", { launchedAt: ago(100) });
  expect(mergePage(snap, [live, launch], { sort: "top", q: "" })).toEqual([live, snap[1]]);
  expect(mints(mergePage(snap, [live, launch], { sort: "latest", q: "" }))).toEqual(["n", "a", "b"]);
  expect(mints(mergePage(snap, [launch], { sort: "latest", q: "gr" }))).toEqual(["a", "b"]);
  const older = coin("a", { mcapSol: 1, lastTradeAt: ago(20_000), launchedAt: ago(2000) });
  expect(mergePage(snap, [older], { sort: "top", q: "" })[0]).toBe(snap[0]);
});

const trade = (slot: number, seq = 0, fresh?: "buy") => ({
  signature: `s${slot}.${seq}`,
  ix: 0,
  slot: String(slot),
  seq: String(seq),
  fresh,
});
const sigs = (l: { signature: string }[]) => l.map((t) => t.signature);

test("addTrades merges in (slot, seq) order and never twice", () => {
  const rows = [trade(5, 0, "buy"), trade(3)];
  expect(sigs(addTrades(rows, [trade(5, 0), trade(4), trade(5, 1)]))).toEqual([
    "s5.1",
    "s5.0",
    "s4.0",
    "s3.0",
  ]);
  expect(addTrades(rows, [trade(3)])).toBe(rows);
  // BigInt, not string order: slot 10 is newer than slot 9
  expect(sigs(addTrades([trade(9)], [trade(10)]))).toEqual(["s10.0", "s9.0"]);
});

test("resyncFeed merges a page that overlaps the loaded rows and replaces one that leaves a hole", () => {
  const feed = { rows: [trade(5, 0, "buy"), trade(3), trade(2)], more: false };
  const overlap = resyncFeed(feed, { rows: [trade(6), trade(4), trade(3)], more: true });
  expect(sigs(overlap.rows)).toEqual(["s6.0", "s5.0", "s4.0", "s3.0", "s2.0"]);
  expect(overlap.more).toBe(false);
  const gap = { rows: [trade(60), trade(59)], more: true };
  expect(resyncFeed(feed, gap)).toBe(gap);
  expect(sigs(resyncFeed(feed, { rows: [trade(9), trade(8)], more: false }).rows)).toEqual([
    "s9.0",
    "s8.0",
    "s5.0",
    "s3.0",
    "s2.0",
  ]);
});
