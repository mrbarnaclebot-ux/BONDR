// Proves an open, visible console lets Neon suspend (D-02, D-22; ADMIN-06), E2E_NEON=1 only. The console sits
// visible and idle for 8 minutes: health polls every 10 s from worker memory and the Postgres-backed overview is
// never called, so the dev branch's compute goes idle. Stop every other local process that writes to the dev DB
// first; the worker for this run is the plain admin one (apps/worker/README.md, without ADMIN_EVACUATE=on).
// neonctl 8.10.3 has no `endpoints list`, so the state comes from its authenticated `neonctl api` passthrough.
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { openConsole } from "./admin.ts";

const PROJECT = "royal-waterfall-05278863";
const WAIT_MS = 8 * 60_000;

test.describe.configure({ timeout: 12 * 60_000 });
test.skip(process.env.E2E_NEON !== "1", "8-minute Neon suspend check: set E2E_NEON=1");

const neon = <T>(path: string): T =>
  JSON.parse(execFileSync("neonctl", ["api", `/projects/${PROJECT}/${path}`], { encoding: "utf8" })) as T;

test("the dev compute suspends while the console stays open and health keeps answering", async ({ page }) => {
  const calls = { health: 0, ok: 0, overview: 0 };
  page.on("response", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === "/api/admin/health") {
      calls.health++;
      if (r.status() === 200) calls.ok++;
    }
    if (path === "/api/admin/overview") calls.overview++;
  });
  await openConsole(page);
  await page.waitForTimeout(WAIT_MS); // no clicks: the tab stays visible and idle
  console.log(`health ${calls.health} (${calls.ok} ok), overview ${calls.overview} in 8 min`);
  expect(calls.ok).toBeGreaterThanOrEqual(40);
  expect(calls.overview).toBe(0);

  const { branches } = neon<{ branches: { id: string; name: string }[] }>("branches");
  const dev = branches.find((b) => b.name === "dev");
  const { endpoints } = neon<{
    endpoints: { branch_id: string; current_state: string; last_active: string }[];
  }>("endpoints");
  const ep = endpoints.find((e) => e.branch_id === dev?.id);
  const idleFor = Date.now() - Date.parse(ep?.last_active ?? "");
  console.log(
    `dev compute ${ep?.current_state}, last active ${ep?.last_active}, now ${new Date().toISOString()}`,
  );
  expect(ep?.current_state === "idle" || idleFor >= 5 * 60_000, "dev compute idle").toBe(true);
});
