import { defineConfig, devices } from "@playwright/test";
// Importing the web config runs its allowlist loader in this process too, so the runner holds only the
// WEB_ENV names from the root .env, never the worker secrets. Do not load the root .env here: the web
// server inherits this process's env, and specs that need other values read them themselves.
import { WEB_ENV } from "./apps/web/next.config.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const WORKER_PORT = "8080";
const webEnv: Record<string, string> = { WORKER_URL: `http://127.0.0.1:${WORKER_PORT}` };
for (const name of WEB_ENV) {
  const value = process.env[name];
  if (value !== undefined) webEnv[name] = value;
}

export default defineConfig({
  testDir: "apps/web/e2e",
  testMatch: "**/*.e2e.ts", // not *.spec.ts or *.test.ts, so Vitest never collects these (Pitfall 7)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  // Desktop Chrome carries a normal Chrome user agent, not HeadlessChrome (Pitfall 4).
  // paused.e2e.ts flips the shared kill switch, so it runs alone after every other spec.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: "**/paused.e2e.ts" },
    {
      name: "paused",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/paused.e2e.ts",
      dependencies: ["chromium"],
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          // The worker reads the root .env in its own process only (--env-file never overrides the env
          // passed here). VANITY_THREADS=0 keeps the boot refill from grinding a core during tests.
          command: "node --env-file=.env apps/worker/src/main.ts",
          url: `http://127.0.0.1:${WORKER_PORT}/healthz`,
          reuseExistingServer: true,
          timeout: 60_000,
          env: { VANITY_THREADS: "0", WORKER_PORT },
        },
        {
          command: "pnpm --filter @bondr/web dev",
          url: "http://127.0.0.1:3000/terms",
          reuseExistingServer: true,
          timeout: 120_000,
          env: webEnv,
        },
      ],
});
