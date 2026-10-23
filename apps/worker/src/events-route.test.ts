import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test } from "vitest";
import { eventsHandler, listening, publish } from "./events-route.ts";
import { start } from "./http.ts";

const token = randomBytes(32).toString("hex");
const server = start({}, token, 0, { "GET /events": (req, res) => eventsHandler(req, res, 50) });
let base = "";

beforeAll(async () => {
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

// Reads NDJSON lines off a response until `n` have arrived.
async function lines(res: Response, n: number): Promise<Record<string, unknown>[]> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const dec = new TextDecoder();
  let text = "";
  while (text.split("\n").length <= n) text += dec.decode((await reader.read()).value, { stream: true });
  reader.releaseLock();
  return text.split("\n").slice(0, n).map((l) => JSON.parse(l));
}

const holders = (n: number) => ({ type: "holders", data: { mint: "M", holders: n } }) as const;

test("GET /events refuses a missing or wrong token", async () => {
  expect((await fetch(`${base}/events`)).status).toBe(401);
  const wrong = { authorization: `Bearer ${token.slice(1)}` };
  expect((await fetch(`${base}/events`, { headers: wrong })).status).toBe(401);
});

test("an open stream gets a ping, then every published event once with increasing ids", async () => {
  const ac = new AbortController();
  const res = await fetch(`${base}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: ac.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/x-ndjson");
  const [hello] = await lines(res, 1);
  expect(hello.type).toBe("ping");
  const [epoch, seq] = String(hello.id).split("-").map(Number);
  publish(holders(1));
  publish(holders(2));
  const got = (await lines(res, 3)).filter((l) => l.type !== "ping");
  expect(got).toEqual([
    { id: `${epoch}-${seq + 1}`, ...holders(1) },
    { id: `${epoch}-${seq + 2}`, ...holders(2) },
  ]);
  expect(listening()).toBe(1);
  ac.abort();
  await new Promise((r) => setTimeout(r, 100));
  expect(listening()).toBe(0);
  publish(holders(3)); // no subscriber left: nothing to write to, nothing throws
});
