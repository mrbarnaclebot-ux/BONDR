# apps/web

The Next.js app: pages, route handlers and the browser code. Routes are in `app/`, UI in `components/`, server and shared helpers in `lib/` (see its README), Playwright specs in `e2e/`.

- `next.config.ts`: which root `.env` names web may read, security headers (CSP, HSTS, framing) and the `/` redirect.
- `proxy.ts`: www to apex 308 (built from SITE_URL), then the rate limit on the seven public read paths (`READ_PATHS`, `/api/live` on its own scope).
- `instrumentation.ts`, `instrumentation-client.ts`: Sentry, errors only, scrubbed.
