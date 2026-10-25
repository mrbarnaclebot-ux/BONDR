// Open Sentry issues for the two BONDR projects (D-27, A3), cached 60 s, read only when a token is set.
import { beforeEach, expect, test, vi } from "vitest";

const TOKEN = "sntryu_SECRET_TOKEN";
let sentryCount: typeof import("./sentry-count.ts").sentryCount;
beforeEach(async () => {
  vi.resetModules();
  ({ sentryCount } = await import("./sentry-count.ts"));
});

const issues = (...slugs: string[]) => slugs.map((slug, i) => ({ id: String(i), project: { slug } }));
const reply = (body: unknown, status = 200) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));

test("no token reports not configured and makes no request", async () => {
  const f = reply([]);
  expect(await sentryCount(null, f as never)).toEqual({ configured: false });
  expect(f).not.toHaveBeenCalled();
});

test("counts by project slug with the bearer token; 100 issues means capped", async () => {
  const f = reply(issues("bondr-web", "bondr-web", "bondr-web", "bondr-worker", "bondr-worker", "other"));
  expect(await sentryCount(TOKEN, f as never, 0)).toEqual({ configured: true, web: 3, worker: 2, capped: false });
  const [url, init] = f.mock.calls[0];
  expect(url).toContain("sentry.io/api/0/organizations/mrbarnacle/issues/");
  expect(url).toContain("query=is:unresolved");
  expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);

  vi.resetModules();
  const fresh = (await import("./sentry-count.ts")).sentryCount;
  const full = reply(issues(...Array(100).fill("bondr-worker")));
  expect(await fresh(TOKEN, full as never, 0)).toEqual({ configured: true, web: 0, worker: 100, capped: true });
});

test("a second call within 60 s shares the first request; after 60 s it reads again", async () => {
  const f = reply(issues("bondr-web"));
  const [a, b] = await Promise.all([sentryCount(TOKEN, f as never, 0), sentryCount(TOKEN, f as never, 59_999)]);
  expect(a).toEqual(b);
  expect(f).toHaveBeenCalledTimes(1);
  await sentryCount(TOKEN, f as never, 60_000);
  expect(f).toHaveBeenCalledTimes(2);
});

test("a failed read reports failed, is not cached, and never shows the token", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const bad = reply({ detail: "nope" }, 403);
  expect(await sentryCount(TOKEN, bad as never, 0)).toEqual({ configured: true, failed: true });
  const thrown = vi.fn(async () => {
    throw new Error("network down");
  });
  expect(await sentryCount(TOKEN, thrown as never, 1)).toEqual({ configured: true, failed: true });
  expect(bad).toHaveBeenCalledTimes(1);
  expect(thrown).toHaveBeenCalledTimes(1);
  const ok = reply(issues("bondr-worker"));
  expect(await sentryCount(TOKEN, ok as never, 2)).toMatchObject({ worker: 1 });
  expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  log.mockRestore();
});
