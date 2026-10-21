---
phase: 02-launch-flow
plan: 14
subsystem: ops
tags: [sentry, privacy, bundle-gate, boot-guard]
requires:
  - phase: 02-04
    provides: Sentry env names (NEXT_PUBLIC_SENTRY_DSN, SENTRY_DSN, sentry_auth_token), owner approval to create bondr-web and bondr-worker
  - phase: 02-12
    provides: worker routes and console warnings (ops low, prepare build failed, vanity pool low)
provides:
  - "@bondr/core/scrub: scrub (32-44 char base58 runs become [addr], all-hex ids kept, bigints stringified), forbiddenEnv, dataCollection (shared restrictive Sentry v11 options)"
  - "apps/worker/src/sentry.ts: no-op without SENTRY_DSN; captureConsole warn+error; flush() before a failed-boot exit"
  - "apps/web/instrumentation.ts: FEE-10 boot guard (exit 1, names only) then server Sentry; onRequestError"
  - "apps/web/instrumentation-client.ts: browser Sentry, errors only, onRouterTransitionStart"
  - "GET /api/sentry-test (404 unless SENTRY_TEST_ROUTE=1) and worker POST /sentry-test (bearer token)"
  - "scripts/check-client-bundle.sh with --self-test; pnpm check:bundle"
affects: [02-15, 02-16, 02-17, 02-18, phase-06-admin]
tech-stack:
  added: ["@sentry/node 11.4.0 (worker)", "@sentry/nextjs 11.4.0 (web)"]
  patterns:
    - "Worker reports through console: captureConsoleIntegration turns every console.warn / console.error into an event, so existing alerts needed no code change"
    - "One dataCollection object in core, spread by name into all three Sentry.init calls"
    - "A side-effect import (import \"./sentry.ts\") keeps Sentry first in main.ts, because Biome import sorting does not reorder across it"
key-decisions:
  - "dataCollection lives in core/scrub.ts so web server, web client and worker cannot drift; also turns off stackFrameVariables (key material in locals) and queues, and denies referer"
  - "scrub keeps all-hex runs: Sentry event_id and trace ids are 32 hex chars and about 1 in 8 has no 0, so the plain regex would have broken event ids"
  - "scrub stringifies bigints: worker console breadcrumbs carry raw lamport args and JSON.stringify would throw"
  - "forbiddenEnv ignores empty values: an empty name holds no secret"
  - "Client environment comes from next.config env NEXT_PUBLIC_SENTRY_ENVIRONMENT = RAILWAY_ENVIRONMENT_NAME ?? local at build time"
  - "withSentryConfig with silent and telemetry false, no authToken (source maps Phase 7)"
requirements-completed: [FEE-10]
duration: ~45 min
completed: 2026-10-21
---

# Phase 2 Plan 14: Sentry, address scrub and FEE-10 gates Summary

**Sentry is wired on the web server, the web client and the worker with a restrictive v11 dataCollection and a base58 scrub. The web refuses to boot holding a seed or owner secret, and the client bundle gate passes. Proven end to end against a local fake Sentry ingest; the live check in the real Sentry projects waits on the DSNs.**

## Performance

- **Duration:** about 45 min
- **Completed:** 2026-10-21
- **Tasks:** 2 of 2 code tasks; the live Sentry check is pending (see Checkpoint)
- **Files:** 15 (7 created, 8 modified)

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Scrub and seed guard in core, bundle gate script | 3c9a9cf |
| 2 | Sentry on worker and web, boot guard, test routes | 46a0903 |

## Evidence

- `pnpm test`: 94 passed, 1 skipped (includes 4 scrub tests). `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` all green.
- `sh scripts/check-client-bundle.sh --self-test`: "check-client-bundle: self-test ok". On the fresh build the gate exits 0.
- Boot guard: `MASTER_SEED=test pnpm --filter @bondr/web start` exited 1 with "web refuses to start: it must not hold MASTER_SEED". `helius_api_key=test ...` exited 1 the same way. A clean start keeps serving.
- `GET /api/sentry-test` returns 404 `not_found` without SENTRY_TEST_ROUTE.
- Fake ingest run (a node:http server on 127.0.0.1 that logs envelopes; DSNs pointed at it, the web built with the fake client DSN, then rebuilt clean):
  - Worker: one event, "POST /sentry-test failed: sentry test from worker: wallet [addr]".
  - Web server: one exception event (mechanism auto.function.nextjs.on_request_error), "sentry test from web: wallet [addr]".
  - Web client (Playwright, uncaught error on /launch?from=<addr>): one exception, "sentry test from client: wallet [addr]"; request url and navigation breadcrumbs show `from=[addr]`; console breadcrumb "client log [addr]".
  - Raw address hits across all envelopes: 0. No `user` object anywhere; client settings `infer_ip: never`; authorization and x-forwarded-* headers `[Filtered]`; the Helius RPC breadcrumb url has no query (api key stripped).
- Acceptance greps: no `sendDefaultPii`; `dataCollection` in all three init files; no replay or non-zero tracesSampleRate; `RAILWAY_ENVIRONMENT_NAME` in instrumentation.ts and worker sentry.ts.

## Checkpoint: live Sentry events (OPS-01)

Not done: `.env` has no `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` or `sentry_auth_token`. It has `SENTRY_PERSONAL_TOKEN` and `SENTRY_API_KEY`, which the plan does not name. The remaining step needs one of:
- Add `SENTRY_DSN` (bondr-worker) and `NEXT_PUBLIC_SENTRY_DSN` (bondr-web), plus `sentry_auth_token` to read events back; or
- Confirm `SENTRY_PERSONAL_TOKEN` may be used as the auth token, to create the two projects (approved 2026-10-19 in 02-04) and append both DSNs.

Then: build the web, start worker and web with SENTRY_TEST_ROUTE=1, hit /api/sentry-test once, and read the latest event of each project through the API with `node --env-file=.env <scratch script>`. OPS-01 stays open until then.

## Deviations from Plan

1. **[Rule 1 - Bug] scrub kept all-hex runs.** The planned regex also matches Sentry's 32-hex event_id and trace ids when they contain no 0, about 1 event in 8. Those runs are now kept. Test added. Commit 3c9a9cf.
2. **[Rule 1 - Bug] scrub stringifies bigints.** Worker console breadcrumbs carry bigint args, and JSON.stringify would throw inside beforeBreadcrumb. Test added. Commit 3c9a9cf.
3. **[Rule 2 - Privacy] Stricter dataCollection.** Also turns off `stackFrameVariables` and `queues`, and adds `referer` to the header deny list. It lives in core/scrub.ts, a file not in Task 2's list, so the three inits share one object. Commit 46a0903.
4. **[Rule 2] Worker flushes Sentry before the failed-boot exit**, so the boot error is not dropped. Worker `ignoreErrors` drops the bigint-buffer "Failed to load bindings" warning, which would otherwise be an event on every boot. Commit 46a0903.
5. **[Rule 3] Worker test route is in main.ts's route map**, not http.ts. It is still behind the bearer check in http.ts handle(), and it errors through the existing 500 path, which logs with redact and console.error.
6. **[Rule 3] The nodejs branch is a block in instrumentation.ts.** An early return made Turbopack warn that process.exit is unsupported in the Edge Runtime.
7. **.env.example:** added `SENTRY_TEST_ROUTE=` under web.
8. **TDD:** RED was run (the scrub tests failed with no module), but it was not committed separately. The constraint is lint, typecheck and tests green before every commit, so the tests and the implementation went into one commit.

## Notes for later plans

- NEXT_PUBLIC_SENTRY_DSN is inlined at build time in both the server and client bundles. On Railway it has to be set as a build variable on the web service, not just at runtime. The same applies to RAILWAY_ENVIRONMENT_NAME for the client environment.
- No `app/global-error.tsx`: React render errors caught by Next's default boundary are not reported from the browser. Uncaught errors and server errors are. Add it when a render error shows up.
- Deploy runs `pnpm check:bundle` after the web build (02-15+ CI or deploy script).

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model. The worker's POST /sentry-test is always on but sits behind the bearer token (T-02-14-04).

## Self-Check: PASSED

- Files present: packages/core/src/scrub.ts, packages/core/src/scrub.test.ts, scripts/check-client-bundle.sh, apps/worker/src/sentry.ts, apps/web/instrumentation.ts, apps/web/instrumentation-client.ts, apps/web/app/api/sentry-test/route.ts.
- Commits 3c9a9cf and 46a0903 are on phase-02-launch-flow.
