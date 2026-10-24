// liveBar: how a live trade lands on the chart (same bucket widens, newer appends at the last close, older drops).
import type { TradeRow } from "@bondr/core/api";
import { expect, test } from "vitest";
import { liveBar } from "./token-chart-draw";

const trade = (at: number, mcapSol: number | null, side: TradeRow["side"] = "buy") =>
  ({ side, mcapSol, sol: "500000000", at: new Date(at * 1000).toISOString() }) as TradeRow;
const last = { time: 600, open: 8, high: 12, low: 8, close: 12, volume: 1 };

test("liveBar updates, appends or drops", () => {
  expect(liveBar(last, trade(650, 7), 60, 5)).toEqual({ ...last, low: 7, close: 7, volume: 1.5 });
  expect(liveBar(last, trade(700, 13), 60, 5)).toEqual({
    time: 660,
    open: 12,
    high: 13,
    low: 12,
    close: 13,
    volume: 0.5,
  });
  expect(liveBar(last, trade(599, 13), 60, 5)).toBeNull();
  expect(liveBar(last, trade(650, 13, "burn"), 60, 5)).toBeNull();
  expect(liveBar(last, trade(650, null), 60, 5)).toBeNull();
  expect(liveBar(null, trade(30, 9), 60, 5)).toEqual({
    time: 0,
    open: 5,
    high: 9,
    low: 5,
    close: 9,
    volume: 0.5,
  });
});
