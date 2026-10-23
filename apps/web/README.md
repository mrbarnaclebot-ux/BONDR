# apps/web

The Next.js app: pages, route handlers and the browser code. Routes are in `app/`, UI in `components/`, server and shared helpers in `lib/` (see its README), Playwright specs in `e2e/`.

- `next.config.ts`: which root `.env` names web may read, security headers (CSP, HSTS, framing) and the `/` redirect.
- `proxy.ts`: rate limit on the public reads (`/coin/:mint`, `/api/launch/:id`, `/api/status`).
- `instrumentation.ts`, `instrumentation-client.ts`: Sentry, errors only, scrubbed.
