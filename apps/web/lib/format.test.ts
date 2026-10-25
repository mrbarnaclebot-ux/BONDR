import { SUPPLY } from "@bondr/core/price";
import { expect, test } from "vitest";
import {
  age,
  burnedPct,
  chartInterval,
  compact,
  curvePct,
  explorer,
  feeSol,
  mcapSol,
  pct,
  ratio1000,
  ratioPct,
  relTime,
  short,
  signedPct,
  sol,
  thousands,
  tradeSol,
  utcStamp,
  windowLeft,
} from "./format";

test("sol trims trailing zeros and rounds to the given places", () => {
  expect(sol(2_500_000n)).toBe("0.0025");
  expect(sol("500000000")).toBe("0.5");
  expect(sol(2_000_000_000n)).toBe("2");
  expect(sol(2_377_323n, 3)).toBe("0.002");
  expect(sol(11_917_680n, 4)).toBe("0.0119");
});

test("sol rounds costs up so a real fee never reads 0", () => {
  expect(sol(10_600n, 4)).toBe("0");
  expect(sol(10_600n, 4, true)).toBe("0.0001");
  expect(sol(11_917_680n, 4, true)).toBe("0.012");
});

test("pct has a receipt form and a prose form", () => {
  expect(pct(150)).toBe("1.50%");
  expect(pct(150, true)).toBe("1.5%");
  expect(pct(95)).toBe("0.95%");
  expect(pct(30, true)).toBe("0.3%");
  expect(pct(0)).toBe("0.00%");
});

test("compact, short and explorer", () => {
  expect(compact("31120363129478")).toBe("31.1M");
  expect(short("4xEfLsmWx8o89XA9iWtf2T5KESn3hLjT4sLK7kBJbndr")).toBe("4xEf…bndr");
  expect(explorer("tx", "sig", "devnet")).toBe("https://solscan.io/tx/sig?cluster=devnet");
  expect(explorer("token", "m", "mainnet")).toBe("https://solscan.io/token/m");
});

test("age reads days and hours, hours and minutes, or minutes", () => {
  const t = Date.parse("2026-10-22T12:00:00Z");
  expect(age("2026-10-19T04:30:00Z", t)).toBe("3d 7h");
  expect(age("2026-10-22T06:48:00Z", t)).toBe("5h 12m");
  expect(age("2026-10-22T11:56:00Z", t)).toBe("4m");
  expect(age("2026-10-22T11:59:59Z", t)).toBe("1m");
});

test("mcapSol drops decimals as the value grows", () => {
  expect(mcapSol(18400)).toBe("18,400");
  expect(mcapSol(140.72)).toBe("140.7");
  expect(mcapSol(61.4)).toBe("61.40");
  expect(mcapSol(0.8421)).toBe("0.842");
});

test("tradeSol has 3 decimals and a floor", () => {
  expect(tradeSol("12345")).toBe("<0.001");
  expect(tradeSol("1234567")).toBe("0.001");
  expect(tradeSol("2500000000")).toBe("2.500");
});

test("signedPct, curvePct and thousands", () => {
  expect(signedPct(0.182)).toBe("+18.2%");
  expect(signedPct(-0.022)).toBe("\u22122.2%");
  expect(signedPct(0)).toBe("0.0%");
  expect(curvePct(0.6421)).toBe("64.2%");
  expect(curvePct(0.29)).toBe("29.0%");
  expect(curvePct(1.2)).toBe("100%");
  expect(thousands(2940180)).toBe("2,940,180");
});

test("relTime reads now, seconds, minutes, hours or days", () => {
  const t = Date.parse("2026-10-22T12:00:00Z");
  const ago = (s: number) => relTime(new Date(t - s * 1000).toISOString(), t);
  expect(ago(3)).toBe("now");
  expect(ago(12)).toBe("12s");
  expect(ago(240)).toBe("4m");
  expect(ago(3 * 3600)).toBe("3h");
  expect(ago(2 * 86_400)).toBe("2d");
});

test("chartInterval follows coin age (D-17)", () => {
  const now = Date.parse("2026-10-23T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3_600_000).toISOString();
  expect([0, 5.9, 6, 71.9, 72, 400].map((h) => chartInterval(ago(h), now))).toEqual([
    "1m",
    "1m",
    "5m",
    "5m",
    "1h",
    "1h",
  ]);
});

test("feeSol reads 0, a floor, then the mcapSol rules", () => {
  expect(feeSol("0")).toBe("0");
  expect(feeSol("400000")).toBe("<0.001");
  expect(feeSol("420000000")).toBe("0.42");
  expect(feeSol("140720000000")).toBe("140.7");
});

test("utcStamp is the UTC date and minute", () => {
  expect(utcStamp("2026-10-18T21:14:09.000Z")).toBe("2026-10-18 21:14");
});

test("ratioPct floors from base units and never rounds up to the trigger", () => {
  expect(ratioPct("1049", "1000")).toBe("104.9%");
  expect(ratioPct("1049999", "1000000")).toBe("104.9%");
  expect(ratioPct("0", "1000")).toBe("0.0%");
  expect(ratioPct("5", null)).toBe("–");
  expect(ratioPct("5", "0")).toBe("–");
  expect(ratio1000("1060", "1000")).toBe(1060);
  expect(ratio1000("1", null)).toBeNull();
});

test("windowLeft reads hours and minutes, minutes, then <1m", () => {
  expect(windowLeft(13 * 3600e3 + 22 * 60e3 + 5e3)).toBe("13h 22m");
  expect(windowLeft(42 * 60e3)).toBe("42m");
  expect(windowLeft(30e3)).toBe("<1m");
  expect(windowLeft(-5e3)).toBe("<1m");
});

test("burnedPct floors to 2 decimals of the supply", () => {
  expect(burnedPct("34200000000000", SUPPLY)).toBe("3.42%");
  expect(burnedPct("34299999999999", SUPPLY)).toBe("3.42%");
  expect(burnedPct("0", SUPPLY)).toBe("0.00%");
});
