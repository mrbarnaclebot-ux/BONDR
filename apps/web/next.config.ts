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
  "SITE_URL",
] as const;

// Local only: Railway has no file and sets each web variable on the service.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) {
  const all = parseEnv(readFileSync(rootEnv, "utf8"));
  for (const name of WEB_ENV) {
    if (process.env[name] === undefined && all[name] !== undefined) process.env[name] = all[name];
  }
}

// The page hands a transaction to Phantom, so the CSP keeps every script, frame and fetch on our own origin:
// images come only from the IPFS hosts rules.ts allows, and errors go only to Sentry (web IN-03).
// ponytail: script-src keeps 'unsafe-inline' for Next's inline bootstrap; a nonce from proxy.ts removes it,
// at the cost of rendering every page dynamically.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data: https://ipfs.io https://*.mypinata.cloud",
  "connect-src 'self' https://*.ingest.us.sentry.io",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

// Clickjacking of the sign flow is the main framing risk, so framing is refused twice (old and new header).
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000" }, // browsers ignore it over plain http
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
];

const config: NextConfig = {
  transpilePackages: ["@bondr/core"], // raw .ts exports (D-15)
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1"], // the e2e baseURL; next dev otherwise blocks its own scripts and HMR there
  // No images.remotePatterns: no coin image goes through /_next/image yet (both use unoptimized or CSS), and
  // allowing IPFS hosts would make it a public IPFS proxy on the gateway quota (web WR-07). Phase 3 adds the
  // dedicated gateway alone, with a response size cap, when coin lists route images through it.
  agentRules: false, // next dev would otherwise write a second AGENTS.md here, shadowing the root one
  // The browser has no runtime env, so the client Sentry environment is fixed at build time.
  // PINATA_GATEWAY is public (it is in every on-chain URI); the client needs it for the step 5 image.
  env: {
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT_NAME ?? "local",
    PINATA_GATEWAY: process.env.PINATA_GATEWAY ?? "",
  },
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
