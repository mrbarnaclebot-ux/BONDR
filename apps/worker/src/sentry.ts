// OPS-01: worker errors and warnings to the bondr-worker Sentry project. Imported first by main.ts so the SDK
// is up before anything logs. Without SENTRY_DSN nothing here runs: logs only. Never log the DSN.
import { dataCollection, scrub } from "@bondr/core/scrub";
import * as Sentry from "@sentry/node";

const dsn = process.env.SENTRY_DSN?.trim();

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || "local",
    // SDK 11 defaults this to true, which turns every console message into a synthetic exception.
    attachStacktrace: false,
    dataCollection,
    // bigint-buffer warns at every boot (its native build is skipped on purpose); not worth an event.
    ignoreErrors: [/^bigint: Failed to load bindings/],
    integrations: [
      // Keep Node's crash on an unhandled rejection (Sentry defaults to warn), so Railway restarts us.
      Sentry.onUnhandledRejectionIntegration({ mode: "strict" }),
      // The worker already reports through console (ops below floor, vanity pool low, route and settle failures).
      Sentry.captureConsoleIntegration({ levels: ["warn", "error"] }),
    ],
    // D-19: no wallet address leaves in an event or a breadcrumb.
    beforeSend: scrub,
    beforeBreadcrumb: scrub,
  });
}

// Before a deliberate exit, so the last error is not lost in the send queue.
export const flush = (ms = 2000): Promise<boolean> => (dsn ? Sentry.flush(ms) : Promise.resolve(true));
