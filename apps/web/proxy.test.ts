// The www to apex redirect (D-07) and the unchanged read-path rate limit (Pitfall 16).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { proxy } from "./proxy.ts";

const req = (url: string, init: { method?: string; host?: string; fwd?: string; ip?: string } = {}) => {
  const headers = new Headers({ "x-real-ip": init.ip ?? "10.9.9.9" });
  if (init.host) headers.set("host", init.host);
  if (init.fwd) headers.set("x-forwarded-host", init.fwd);
  return new Request(url, { method: init.method ?? "GET", headers });
};

beforeEach(() => vi.stubEnv("SITE_URL", "https://trybondr.fun"));
afterEach(() => vi.unstubAllEnvs());

test("www answers 308 to the apex with the same path and query, for any method", () => {
  for (const method of ["GET", "POST"]) {
    const r = proxy(req("http://internal:8080/coin/abc?x=1", { method, fwd: "www.trybondr.fun" }));
    expect(r?.status).toBe(308);
    expect(r?.headers.get("location")).toBe("https://trybondr.fun/coin/abc?x=1");
  }
  const byHost = proxy(req("https://www.trybondr.fun/", { host: "www.trybondr.fun" }));
  expect(byHost?.headers.get("location")).toBe("https://trybondr.fun/");
});

test("a protocol-relative path never leaves SITE_URL's origin", () => {
  for (const path of ["//evil.example/x?y=1", "/\\evil.example/x?y=1"]) {
    const r = proxy(req(`http://internal:8080${path}`, { fwd: "www.trybondr.fun" }));
    expect(r?.headers.get("location")).toBe("https://trybondr.fun//evil.example/x?y=1");
  }
});

test("no other host is redirected, and none without SITE_URL", () => {
  for (const fwd of [
    "www.evil.example",
    "trybondr.fun",
    "www.trybondr.fun.evil.example",
    "evil.www.trybondr.fun",
  ])
    expect(proxy(req("https://trybondr.fun/launch", { fwd }))).toBeUndefined();
  vi.stubEnv("SITE_URL", "");
  expect(proxy(req("https://trybondr.fun/launch", { fwd: "www.trybondr.fun" }))).toBeUndefined();
});

test("the rate limit still covers only the seven read paths", () => {
  const ip = "10.1.2.3";
  for (let i = 0; i < 400; i++) expect(proxy(req("https://trybondr.fun/launch", { ip }))).toBeUndefined();
  for (let i = 0; i < 300; i++)
    expect(proxy(req("https://trybondr.fun/api/coins?sort=new", { ip }))).toBeUndefined();
  expect(proxy(req("https://trybondr.fun/coin/abc", { ip }))?.status).toBe(429);
  for (const path of ["/", "/api/status", "/api/coin/abc/trades", "/api/launch/xyz"])
    expect(proxy(req(`https://trybondr.fun${path}`, { ip }))?.status).toBe(429);
  for (const path of ["/terms", "/admin", "/api/launch/xyz/extra", "/coinage", "/api/coins/x"])
    expect(proxy(req(`https://trybondr.fun${path}`, { ip }))).toBeUndefined();
  expect(proxy(req("https://trybondr.fun/api/coins", { ip, method: "POST" }))).toBeUndefined();
});

test("/api/live keeps its own 30 a minute scope", () => {
  const ip = "10.4.5.6";
  for (let i = 0; i < 30; i++) expect(proxy(req("https://trybondr.fun/api/live", { ip }))).toBeUndefined();
  expect(proxy(req("https://trybondr.fun/api/live", { ip }))?.status).toBe(429);
});
