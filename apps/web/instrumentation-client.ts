// OPS-01 browser errors. No tracing and no replay: errors only. The DSN is public by design; without it the
// SDK stays disabled.
import { dataCollection, scrub } from "@bondr/core/scrub";
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, // set at build time in next.config.ts
  dataCollection,
  beforeSend: scrub,
  beforeBreadcrumb: scrub,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
