---
phase: 06-admin-dashboard
plan: 08
subsystem: worker
tags: [worker, admin-gate, health, rpc, sentry, env, tdd]
requires: [06-07]
provides:
  - env.ts adminWallet (invalid or unset is null), adminEvacuate (simulate|on, default simulate), sentryReadToken
  - admin-routes.ts gated, adminRoutes, AdminOpts, POST /admin/health
  - rpc-stats.ts timedFetch, note, rpcStats
  - sentry-count.ts sentryCount (60 s shared promise, 5 s timeout)
  - health.ts healthSnapshot (memory only)
  - core net.ts connect(net, { fetch })
  - Engine.stuckCount() returns AdminHealth["stuck"]
affects: [06-09 web health panel, 06-10+ every later admin route, 06-22 EVACUATE]
tech-stack:
  added: []
  patterns: [one gate wrapper applied to the whole admin route map, memory-only health with a 60 s cached outbound read]
key-files:
  created:
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/admin-routes.test.ts
    - apps/worker/src/env.test.ts
    - apps/worker/src/rpc-stats.ts
    - apps/worker/src/rpc-stats.test.ts
    - apps/worker/src/sentry-count.ts
    - apps/worker/src/sentry-count.test.ts
    - apps/worker/src/health.test.ts
  modified:
    - apps/worker/src/env.ts
    - apps/worker/src/health.ts
    - apps/worker/src/main.ts
    - apps/worker/src/stream.ts
    - apps/worker/src/fee-engine.ts
    - apps/worker/src/fee-engine-admin.test.ts
    - apps/worker/src/README.md
    - packages/core/src/net.ts
decisions:
  - "06-08: adminRoutes wraps its whole route map with gated in one place; a later plan only adds a key to that map and cannot skip the allowlist"
  - "06-08: lastEngine is the newest job mark (split, bondCheck, sweep, distribute, buyback); the unused 'engine' mark was removed"
  - "06-08: Engine.stuckCount() now returns the AdminHealth stuck shape ({ mint, step, attempts } for the oldest stuck coin) instead of the bare mint"
  - "06-08: the Sentry read has a 5 s abort timeout so a slow Sentry cannot hold the 10 s health poll"
metrics:
  duration: 13 min
  completed: 2026-10-25
  tasks: 3
  files: 16
---

# Phase 6 Plan 08: Admin gate and memory-only health Summary

The worker's admin door is open and closed by default. Every `/admin/*` route runs through `gated`, which answers 403 forbidden unless ADMIN_WALLET is set and the forwarded `body.actor` matches it. The bearer check still runs first. The first route, POST /admin/health, answers only from worker memory: boot time, instance, the stream's last message, the last run of each job, RPC p50/p95/error rate/429s over the last hour, the stuck count, the five switches with evacuated_at, the fee engine mode, the ops floor flag, the EVACUATE mode and the open Sentry issue count.

## What was built

- `env.ts`: `adminWallet` (a canonical base58 key, else null, never throws, D-08), `adminEvacuate` (default simulate; any other value throws; on with a non-devnet net throws, A2), `sentryReadToken` (trimmed or null). None of them is ever logged.
- `admin-routes.ts`: `gated(admin, h)` and `adminRoutes({ env, engine, conn })`. The map is wrapped in a single pass, so no route can skip the gate. The handler gets the whole body, actor included.
- `rpc-stats.ts`: `timedFetch` records `{ at, ms, status }` (status 0 when the fetch throws, then rethrows). Each insert drops samples older than 1 h and caps the ring at 50,000. `rpcStats` gives nearest-rank p50/p95, errorRate (any non-2xx or thrown call) and rateLimited (429), and also filters by `now`, so stale samples drop out with no insert. A `ponytail:` comment notes that JSON-RPC errors inside a 200 are not counted.
- `sentry-count.ts`: GET `sentry.io/api/0/organizations/mrbarnacle/issues/?query=is:unresolved&limit=100` with a Bearer token. It counts the `bondr-web` and `bondr-worker` slugs, and 100 results sets `capped`. The answer is shared for 60 s. A failure is not cached and returns `{ configured: true, failed: true }`. With no token it sends no request.
- `health.ts healthSnapshot`: reads marks, switchState, rpcStats, `engine()?.stuckCount()`, env and `opsLow()`. Its only await is the cached Sentry count.
- `net.ts connect(net, { fetch })` passes the option into the Connection config. `main.ts` uses `{ fetch: timedFetch }` and spreads `adminRoutes({ env, engine: feeEngine, conn })` next to feeRoutes.
- `stream.ts` calls `mark("stream")` next to `l.seen = Date.now()`.

## Commits

| Task | Commit | Message |
| ---- | ------ | ------- |
| 1 RED | 103f0fd | test(06-08): add failing tests for the admin env names and the gate |
| 1 GREEN | 67a8747 | feat(06-08): parse the admin env names and close the admin door by default |
| 2 RED | 4f42fe7 | test(06-08): add failing tests for the RPC ring and the Sentry count |
| 2 GREEN | bd9d526 | feat(06-08): time every RPC call in a one-hour ring and count open Sentry issues |
| 3 RED | 04822f6 | test(06-08): add failing tests for the memory-only health snapshot |
| 3 GREEN | 7f51efa | feat(06-08): answer POST /admin/health from worker memory and mark the stream |

## Verification

- Plan tests (env, admin-routes, rpc-stats, sentry-count, health, net, fee-engine-admin): all pass.
- `pnpm vitest run apps/worker`: 37 files, 260 passed, 1 skipped (261).
- `pnpm lint`, `pnpm typecheck`: clean.
- Full `pnpm test`: 71 files passed, 526 passed, 2 skipped (528).
- health.test.ts mocks `@bondr/core/db` as an empty module. A throwaway check confirmed that any use of that mock throws (`loadSwitches()` rejects), so the snapshot resolving there proves it makes no database read.
- Local worker (`node --env-file=../../.env src/main.ts`, ADMIN_WALLET set in the shell to a throwaway key, port 18181): bearer plus admin actor got 200 with every AdminHealth field, and RPC count 4 from boot calls. Another actor got 403 `{"error":"forbidden"}`. No bearer got 401. The worker was stopped afterwards.
- Acceptance greps: no `"GET /admin`. `gated(` is in admin-routes.ts. No db import in health/rpc-stats/sentry-count. main.ts has `adminRoutes(` and `timedFetch`, and stream.ts has `mark("stream"`. No log of the admin names.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Engine.stuckCount() shape did not match AdminHealth.stuck**
- **Found during:** Task 3
- **Issue:** 06-06 returned `first: string | null` (the mint), but the contract type is `{ mint, step, attempts } | null`.
- **Fix:** stuckCount returns the AdminHealth shape. The one existing assertion in fee-engine-admin.test.ts was updated to match.
- **Files modified:** apps/worker/src/fee-engine.ts, apps/worker/src/fee-engine-admin.test.ts
- **Commit:** 7f51efa

**2. [Rule 2 - Correctness, T-06-08-05] 5 s timeout on the Sentry read**
- A hanging Sentry request would have held the shared promise, so every health poll would hang for up to 60 s. `AbortSignal.timeout(5000)` turns that into the failed state.

**3. Removed the unused `"engine"` mark** from health.ts. lastEngine is computed from the job marks, as the plan says.

## Notes for later plans

- Add admin routes by adding keys to the `routes` map inside `adminRoutes`. They are gated automatically and must be `POST /admin/...` (the table test enforces this). `AdminOpts` carries `env`, `engine` and `conn`.
- The forwarded actor is `body.actor`. Handlers receive it in `body` for the audit.
- ADMIN_WALLET is not set in the local `.env`, so the local admin console stays closed until the owner sets it (in both web and worker).
- fee-engine.ts is now 274 lines.

## Known Stubs

None.

## TDD Gate Compliance

Each task has a `test(...)` commit followed by a `feat(...)` commit. All RED runs failed for the expected reasons: missing exports and the health route's partial answer.

## Self-Check: PASSED
