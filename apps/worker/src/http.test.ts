import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { start } from "./http.ts";

const token = randomBytes(32).toString("hex");
const wrong = randomBytes(32).toString("hex");
const server = start(
  {
    "GET /status": async () => ({ ok: "status" }),
    "POST /quote": async (body) => ({ echo: body }),
    "GET /bigint": async () => ({ n: 1n }),
    "GET /boom": async () => {
      throw new Error("secret stack detail at /Users/x/file.ts:1");
    },
  },
  token,
  0,
);
let base = "";

beforeAll(async () => {
  if (!server.listening) await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

const get = (path: string, auth?: string) =>
  fetch(base + path, auth ? { headers: { authorization: `Bearer ${auth}` } } : {});

test("healthz needs no token", async () => {
  expect(token).toHaveLength(64);
  const res = await get("/healthz");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("every other route refuses a missing or wrong token", async () => {
  expect((await get("/status")).status).toBe(401);
  expect((await get("/status", wrong)).status).toBe(401);
  expect((await get("/status", token.slice(1))).status).toBe(401);
  const ok = await get("/status", token);
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: "status" });
});

test("POST bodies over 16 KB get 413, small JSON passes through", async () => {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const big = JSON.stringify({ pad: "a".repeat(17 * 1024) });
  expect((await fetch(`${base}/quote`, { method: "POST", headers, body: big })).status).toBe(413);
  const res = await fetch(`${base}/quote`, { method: "POST", headers, body: '{"solIn":"1"}' });
  expect(await res.json()).toEqual({ echo: { solIn: "1" } });
  const bad = await fetch(`${base}/quote`, { method: "POST", headers, body: "{" });
  expect(bad.status).toBe(400);
});

test("unknown paths get 404", async () => {
  expect((await get("/nope", token)).status).toBe(404);
});

test("a throwing handler answers 500 build_failed with no stack text", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await get("/boom", token);
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(JSON.parse(text)).toEqual({ error: "build_failed" });
  expect(text).not.toContain("secret");
  expect(log).toHaveBeenCalledOnce();
  log.mockRestore();
});

test("a result that cannot serialize answers 500, not a half-sent 200 (IN-05)", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await get("/bigint", token);
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: "build_failed" });
  log.mockRestore();
});
