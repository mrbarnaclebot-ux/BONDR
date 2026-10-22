import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { withSentryConfig } from "@sentry/nextjs/config";
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
  "SESSION_SECRET",
] as const;

// Local only: Railway has no file and sets each web variable on the service.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
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

// Coin images: the owner's dedicated Pinata gateway host when set, and ipfs.io (the on-chain URI) always.
const gateway = process.env.PINATA_GATEWAY?.trim()
  .replace(/^https?:\/\//, "")
  .replace(/\/.*$/, "");
const IMAGE_HOSTS = [gateway, "ipfs.io"].filter(Boolean).map((host) => new URL(`https://${host}/ipfs/**`));

const config: NextConfig = {
  transpilePackages: ["@bondr/core"], // raw .ts exports (D-15)
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"], // the e2e baseURL; next dev otherwise blocks its own scripts and HMR there
  images: { remotePatterns: IMAGE_HOSTS },
  agentRules: false, // next dev would otherwise write a second AGENTS.md here, shadowing the root one
  // The browser has no runtime env, so the client Sentry environment is fixed at build time.
  env: { NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT_NAME ?? "local" },
  async redirects() {
    // ponytail: Phase 3 replaces / with the home lists
    return [{ source: "/", destination: "/launch", permanent: false }];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

// No authToken: source map upload waits for Phase 7. telemetry off: the build sends nothing to Sentry.
export default withSentryConfig(config, { silent: true, telemetry: false });
