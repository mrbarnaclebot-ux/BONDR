import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { type EventTx, innerEvents } from "./events.ts";

const fixture = (name: string): EventTx =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")).response;

test("innerEvents decodes the mainnet launch's CreateEvent and TradeEvent from emit_cpi", () => {
  const events = innerEvents(fixture("launch-20261008.json"));
  const names = events.map((e) => e.name);
  expect(names).toContain("CreateEvent");
  expect(names).toContain("TradeEvent");
  expect(names.some((n) => n.startsWith("unknown"))).toBe(false);
  const trade = events.find((e) => e.name === "TradeEvent")?.data;
  expect(trade?.mint).toBe("EhLyndhdN7K1VQokfGifFeedMztb73k57WS7Xq9mxsad");
  expect(trade?.isBuy).toBe(true);
});

test("an event under another account 0 is ignored", () => {
  const tx = fixture("launch-20261008.json");
  for (const g of tx.meta?.innerInstructions ?? []) for (const ix of g.instructions) ix.accounts[0] = 0;
  expect(innerEvents(tx)).toEqual([]);
});
