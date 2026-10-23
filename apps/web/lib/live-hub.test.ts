import type { LiveEvent } from "@bondr/core/api";
import { expect, test, vi } from "vitest";
import { createHub, type HubEvent, Ring, splitLines } from "./live-hub";

vi.mock("server-only", () => ({}));

const enc = new TextEncoder();
async function* chunks(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const p of parts) yield enc.encode(p);
}
const ndjson = (...lines: object[]) => chunks(lines.map((l) => `${JSON.stringify(l)}\n`).join(""));
const collect = async (it: AsyncIterable<unknown>) => {
  const out: unknown[] = [];
  for await (const v of it) out.push(v);
  return out;
};

const holders = (id: string, mint: string) =>
  ({ id, type: "holders", data: { mint, holders: 1 } }) as LiveEvent;
const launch = (id: string, mint: string) => ({ id, type: "launch", data: { mint } }) as unknown as LiveEvent;
const ping = (id: string) => ({ type: "ping", id });

test("splitLines joins lines across chunks and skips malformed ones", async () => {
  expect(await collect(splitLines(chunks('{"a":1}\n{"b"', ':2}\nnot json\n\n{"c":3}')))).toEqual([
    { a: 1 },
    { b: 2 },
  ]);
});

test("the ring keeps the last 2,000 events and replays only from an id it still holds", () => {
  const ring = new Ring();
  ring.reset("1-0");
  for (let i = 1; i <= 2001; i++) ring.push(holders(`1-${i}`, "M"));
  expect(ring.since("1-1")).toBeNull(); // pushed out
  expect(ring.since("1-0")).toBeNull();
  expect(ring.since("1-1999")?.map((e) => e.id)).toEqual(["1-2000", "1-2001"]);
  expect(ring.since("1-2001")).toEqual([]);
  expect(ring.since("2-5")).toBeNull(); // another epoch
  expect(ring.head).toBe("1-2001");
});

function hubOf(...streams: AsyncIterable<Uint8Array>[]) {
  const open = vi.fn(async () => streams.shift() ?? new Promise<never>(() => {}));
  return { hub: createHub(open, async () => {}), open };
}

test("a mint filter gets that mint's events only and never launches", async () => {
  const { hub } = hubOf(ndjson(ping("1-0"), holders("1-1", "A"), holders("1-2", "B"), launch("1-3", "C")));
  const [all, onlyA]: HubEvent[][] = [[], []];
  hub.subscribe((e) => all.push(e));
  hub.subscribe((e) => onlyA.push(e), { mint: "A" });
  await vi.waitFor(() => expect(all).toHaveLength(3));
  expect(onlyA.map((e) => e.id)).toEqual(["1-1"]);
  expect(hub.head()).toBe("1-3");
});

test("a reconnecting client replays what it missed, or gets one resync when it cannot", async () => {
  const { hub } = hubOf(ndjson(ping("1-0"), holders("1-1", "A"), holders("1-2", "A"), holders("1-3", "B")));
  hub.subscribe(() => {});
  await vi.waitFor(() => expect(hub.head()).toBe("1-3"));
  const back: HubEvent[] = [];
  hub.subscribe((e) => back.push(e), { mint: "A", lastId: "1-1" });
  expect(back.map((e) => e.id)).toEqual(["1-2"]);
  const fresh: HubEvent[] = [];
  hub.subscribe((e) => fresh.push(e), { lastId: "1-0" });
  expect(fresh.map((e) => e.id)).toEqual(["1-1", "1-2", "1-3"]);
  const lost: HubEvent[] = [];
  hub.subscribe((e) => lost.push(e), { lastId: "0-9" });
  expect(lost).toEqual([{ type: "resync", id: "1-3" }]);
});

test("an upstream reconnect resyncs every client only when it missed events", async () => {
  const { hub, open } = hubOf(
    ndjson(ping("1-0"), holders("1-1", "A")),
    ndjson(ping("1-1"), holders("1-2", "A")), // same position: nothing missed
    ndjson(ping("2-0"), holders("2-1", "A")), // worker restarted
  );
  const got: HubEvent[] = [];
  hub.subscribe((e) => got.push(e), { mint: "A" });
  await vi.waitFor(() => expect(got).toHaveLength(4));
  expect(got).toEqual([
    holders("1-1", "A"),
    holders("1-2", "A"),
    { type: "resync", id: "2-0" },
    holders("2-1", "A"),
  ]);
  expect(open).toHaveBeenCalledTimes(4);
});

test("a subscriber whose write throws is dropped, the others keep receiving", async () => {
  const { hub } = hubOf(ndjson(ping("1-0"), holders("1-1", "A"), holders("1-2", "A")));
  const bad = vi.fn(() => {
    throw new Error("closed");
  });
  const good: HubEvent[] = [];
  hub.subscribe(bad);
  hub.subscribe((e) => good.push(e));
  await vi.waitFor(() => expect(good).toHaveLength(2));
  expect(bad).toHaveBeenCalledOnce();
});
