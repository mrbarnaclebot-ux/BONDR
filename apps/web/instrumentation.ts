// Runs once when the Node server starts. FEE-10 layer 3 first: web refuses to boot holding a seed, the seed
// path, the Helius key, the Sentry token or the staging URL. Next only logs a throw from register() and keeps
// serving, so the refusal exits the process itself (agencybook D-163).
import { dataCollection, forbiddenEnv, scrub } from "@bondr/core/scrub";
import * as Sentry from "@sentry/nextjs";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const held = forbiddenEnv(process.env);
    if (held.length) {
      console.error(`web refuses to start: it must not hold ${held.join(", ")}`); // names only, never values
      process.exit(1);
    }
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined, // unset: the SDK stays disabled
      environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "local",
      dataCollection,
      beforeSend: scrub,
      beforeBreadcrumb: scrub,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
