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
