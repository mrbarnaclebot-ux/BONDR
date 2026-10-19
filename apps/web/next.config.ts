import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// The root .env also holds worker secrets (seed path, Helius key, Sentry token). Web copies only these
// names from it, so a web bug can never leak them. A plan that needs a new web variable adds it here.
export const WEB_ENV = [
  "DATABASE_URL",
  "WORKER_URL",
  "WORKER_TOKEN",
  "pinata_jwt",
  "PINATA_GATEWAY",
  "SOLANA_NET",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_TEST_ROUTE",
] as const;

// Local only: Railway has no file and sets each web variable on the service.
const rootEnv = join(process.cwd(), "../../.env");
if (existsSync(rootEnv)) {
  const all = parseEnv(readFileSync(rootEnv, "utf8"));
  for (const name of WEB_ENV) {
    if (process.env[name] === undefined && all[name] !== undefined) process.env[name] = all[name];
  }
}

// Clickjacking of the sign flow is the main framing risk, so framing is refused twice (old and new header).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const config: NextConfig = {
  transpilePackages: ["@bondr/core"], // raw .ts exports (D-15)
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default config;
