import { randomInt } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { seedAccount } from "./apps/web/e2e/keys.ts";
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

// The test owner key (A10). Only its public address leaves the seed file, and nothing from the root .env is
// copied into process.env. Set explicitly, it wins over any ADMIN_WALLET in the root .env on both servers.
let adminWallet: string | undefined;
try {
  adminWallet = seedAccount("admin:devnet:e2e").address;
} catch {
  adminWallet = undefined; // no MASTER_SEED_FILE: admin specs skip with that reason
}
if (adminWallet) webEnv.ADMIN_WALLET = adminWallet;
// The admin sign-in message names SITE_URL and refuses any other origin (WR-B-03), so it must be baseURL.
webEnv.SITE_URL ??= new URL(baseURL).origin;
const ADMIN = ["**/admin-switch.e2e.ts", "**/admin-moderation.e2e.ts"];
// The console money path on devnet needs its own worker flags and drains every W, so it never shares a run with
// other specs (CR-E-02): E2E_DEVNET_ADMIN=1 pnpm exec playwright test --project=devnet-admin --no-deps.
const DEVNET_ADMIN = "**/admin-devnet.e2e.ts";

export default defineConfig({
  testDir: "apps/web/e2e",
  testMatch: "**/*.e2e.ts", // not *.spec.ts or *.test.ts, so Vitest never collects these (Pitfall 7)
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  // The web routes rate limit per client IP (02-10) and dev reuses one server across runs, so each runner
  // process (each worker loads this file) presents its own random X-Real-IP instead of sharing 127.0.0.1.
  use: {
    baseURL,
    trace: "retain-on-failure",
    extraHTTPHeaders: { "x-real-ip": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` },
  },
  // Desktop Chrome carries a normal Chrome user agent, not HeadlessChrome (Pitfall 4).
  // paused.e2e.ts flips the shared kill switch, so it runs alone after every other spec. The admin specs
  // that flip switches or hide and block coins change shared state too, so they run alone after it.
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/paused.e2e.ts", ...ADMIN, DEVNET_ADMIN],
    },
    {
      name: "paused",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/paused.e2e.ts",
      dependencies: ["chromium"],
    },
    {
      name: "admin-serial",
      use: { ...devices["Desktop Chrome"] },
      testMatch: ADMIN,
      dependencies: ["paused"],
      workers: 1, // both files read the shared audit log's first row, so they never run side by side
    },
    {
      name: "devnet-admin",
      use: { ...devices["Desktop Chrome"] },
      testMatch: DEVNET_ADMIN,
      dependencies: ["admin-serial"],
      workers: 1,
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
          env: { VANITY_THREADS: "0", WORKER_PORT, ...(adminWallet && { ADMIN_WALLET: adminWallet }) },
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
