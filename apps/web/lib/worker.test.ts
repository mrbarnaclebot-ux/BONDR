// The worker's contract errors must reach the browser as themselves, not as worker_unavailable (02-12 note).
import { afterEach, expect, test, vi } from "vitest";
import { workerPost } from "./worker";

vi.mock("server-only", () => ({}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function reply(status: number, body: unknown) {
  vi.stubEnv("WORKER_URL", "http://worker.test");
  vi.stubEnv("WORKER_TOKEN", "t");
  vi.stubGlobal("fetch", async () => Response.json(body, { status }));
}

test.each([
  [410, "expired"],
  [422, "cosign_refused"],
  [409, "paused"],
])("a %i %s passes through with only the contract fields", async (status, error) => {
  reply(status, { error, detail: "worker-only text" });
  expect(await workerPost("/submit", {})).toEqual({ status, body: { error, paused: undefined } });
});

test("a status outside the contract becomes worker_unavailable", async () => {
  reply(401, { error: "unauthorized" });
  expect(await workerPost("/submit", {})).toEqual({ status: 503, body: { error: "worker_unavailable" } });
});

test("a ticker refusal keeps retryAfter and lock and drops every other worker field (D-43, Pitfall 24)", async () => {
  reply(409, { error: "ticker_locked", retryAfter: 75600, lock: "landed", reason: "x", raw: "y" });
  const { status, body } = await workerPost("/prepare", {});
  expect(status).toBe(409);
  expect(body).toEqual({ error: "ticker_locked", retryAfter: 75600, lock: "landed" });
  expect(body).not.toHaveProperty("reason");
  expect(body).not.toHaveProperty("raw");
});

test.each([
  [{ retryAfter: "75600", lock: "held" }],
  [{ retryAfter: Number.POSITIVE_INFINITY, lock: 1 }],
  [{ retryAfter: null, lock: "LANDED" }],
])("a malformed retryAfter or lock is dropped: %o", async (extra) => {
  reply(409, { error: "ticker_locked", ...extra });
  const { body } = await workerPost("/prepare", {});
  expect(body).not.toHaveProperty("retryAfter");
  expect(body).not.toHaveProperty("lock");
});
