import { expect, test } from "vitest";
import { clientIp, rateLimited, take } from "./guard";

const W = 600_000;

test("take allows the limit, then gives the wait in seconds until the window ends", () => {
  const t = 1_000_000;
  for (let i = 0; i < 5; i++) expect(take("t:a", t + i, 5, W)).toBeNull();
  expect(take("t:a", t + 60_000, 5, W)).toBe(540);
  expect(take("t:b", t + 60_000, 5, W)).toBeNull();
  expect(take("t:a", t + W, 5, W)).toBeNull(); // a new window resets
});

test("clientIp prefers x-real-ip, then the rightmost x-forwarded-for entry", () => {
  const req = (h: Record<string, string>) => new Request("https://x.test/", { headers: h });
  expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
  expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 3.3.3.3" }))).toBe("3.3.3.3");
  expect(clientIp(req({}))).toBeNull();
});

test("rateLimited limits per IP and per wallet with a 429 rate_limited", async () => {
  const req = (ip: string) => new Request("https://x.test/", { headers: { "x-real-ip": ip } });
  expect(rateLimited(req("10.0.0.1"), "g1", 1, W, "walletA")).toBeNull();
  // Same wallet from a new IP: the wallet key is over.
  const res = rateLimited(req("10.0.0.2"), "g1", 1, W, "walletA");
  expect(res?.status).toBe(429);
  expect(Number(res?.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  expect(await res?.json()).toEqual({ error: "rate_limited" });
  // Same IP, new wallet: the IP key is over.
  expect(rateLimited(req("10.0.0.1"), "g1", 1, W, "walletB")?.status).toBe(429);
  // Scopes count apart.
  expect(rateLimited(req("10.0.0.1"), "g2", 1, W)).toBeNull();
});

test("an IP over its limit adds no wallet key, so it cannot charge a wallet it names (WR-01)", () => {
  const req = (ip: string) => new Request("https://x.test/", { headers: { "x-real-ip": ip } });
  expect(rateLimited(req("10.1.0.1"), "g3", 1, W)).toBeNull();
  expect(rateLimited(req("10.1.0.1"), "g3", 1, W, "walletC")?.status).toBe(429);
  expect(rateLimited(req("10.1.0.2"), "g3", 1, W, "walletC")).toBeNull();
});

test("the map stays bounded: once full of live windows the oldest key is dropped (WR-01)", () => {
  const t = 5_000_000;
  take("cap:first", t, 1, W);
  expect(take("cap:first", t, 1, W)).not.toBeNull();
  for (let i = 0; i < 10_000; i++) take(`cap:${i}`, t, 1, W);
  expect(take("cap:first", t, 1, W)).toBeNull(); // dropped, so it starts a fresh window
});

test("requests with no client address share one bucket instead of going unlimited (WR-03)", () => {
  const bare = () => new Request("https://x.test/");
  expect(rateLimited(bare(), "g4", 1, W)).toBeNull();
  expect(rateLimited(bare(), "g4", 1, W)?.status).toBe(429);
});
