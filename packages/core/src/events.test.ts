import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { completeEvents, type EventTx, innerEvents } from "./events.ts";

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const fixture = (name: string): EventTx => load(name).response;

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

test("a failed tx yields no events", () => {
  const tx = fixture("forced-bond.json");
  if (tx.meta) tx.meta.err = { InstructionError: [3, { Custom: 6003 }] };
  expect(innerEvents(tx)).toEqual([]);
});

// The fork forced bond (01-07): one tx completes C2 and burns; its mint is the run's state "C2".
test("completeEvents finds exactly one CompleteEvent for the forced-bonded child", () => {
  const { mint } = load("forced-bond.json");
  const events = completeEvents(fixture("forced-bond.json"));
  expect(events).toHaveLength(1);
  expect(events[0]?.mint).toBe(mint);
  expect(completeEvents(fixture("launch-20261008.json"))).toEqual([]);
});
