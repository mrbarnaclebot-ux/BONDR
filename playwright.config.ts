import { defineConfig, devices } from "@playwright/test";
// Importing the web config runs its allowlist loader in this process too, so the runner holds only the
// WEB_ENV names from the root .env, never the worker secrets. Do not load the root .env here: the web
// server inherits this process's env, and specs that need other values read them themselves.
import { WEB_ENV } from "./apps/web/next.config.ts";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";
const webEnv: Record<string, string> = {};
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm --filter @bondr/web dev",
        url: "http://127.0.0.1:3000/terms",
        reuseExistingServer: true,
        timeout: 120_000,
        env: webEnv,
      },
});
