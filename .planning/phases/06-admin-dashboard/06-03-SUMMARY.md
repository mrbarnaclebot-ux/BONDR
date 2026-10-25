---
phase: 06-admin-dashboard
plan: 03
subsystem: auth, web
tags: [auth, session, web, ui, tdd]
requires: [06-01, 06-02]
provides:
  - session.ts ADMIN_COOKIE, adminWalletEnv, adminMessage, adminCookie, adminSession, verifyAdmin, adminSignOutCookie
  - POST /api/admin/session (nonce, verify, signout)
  - POST /api/admin/[op] guarded forwarder with an empty OPS map
  - /admin page, AdminSignIn with useAdminSignIn, AdminConsole with useAdmin
affects: [every later Phase 6 plan: panels render inside AdminConsole and ops register in OPS]
tech-stack:
  added: []
  patterns: [tagged sealed cookie value, shared private verifySigned for consent and admin messages, React context for panel session access]
key-files:
  created:
    - apps/web/app/api/admin/session/route.ts
    - apps/web/app/api/admin/[op]/route.ts
    - apps/web/app/admin/page.tsx
    - apps/web/components/admin-signin.tsx
    - apps/web/components/admin-console.tsx
  modified:
    - apps/web/lib/session.ts
    - apps/web/lib/session.test.ts
    - apps/web/components/README.md
decisions:
  - "06-03: admin nonces reuse issueNonce and are spent in consent_nonces; the first message line 'BONDR admin sign-in' is the domain separation (D-09)"
  - "06-03: verify refuses a non-admin wallet with 403 not_admin before the signature check, so it spends no nonce and sets no cookie"
  - "06-03: panels reach the session through useAdmin() (wallet, exp, onUnauthorized) from a context in AdminConsole, so the server page can pass panels as children"
  - "06-03: Sign out shows the signed-out card only after the clearing cookie lands; on a failed request the console stays"
metrics:
  duration: 20 min
  completed: 2026-10-25
  tasks: 3
  files: 8
---

# Phase 6 Plan 03: Owner sign-in, admin cookie and console shell Summary

The owner opens the unlinked, noindex /admin, connects Phantom, signs one "BONDR admin sign-in" message and lands in the console shell on a 30-minute HttpOnly SameSite=Strict `bondr_admin` cookie. The cookie value is tagged, so a public session value is refused. Every `/api/admin/*` call is a same-origin POST that checks the cookie before the rate limit and before reading the body.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Admin session helpers in session.ts | b8f6348 |
| 2 | The admin session route and the guarded admin forwarder | de2aea9 |
| 3 | /admin page, sign-in card and console shell | 5664087 |

## Task notes

- Task 1 (TDD): the 4 new cases failed first because the helpers did not exist yet. With the helpers in, session.test.ts has 9 tests passing. `verifyConsent` and `verifyAdmin` both call a private `verifySigned` and differ only in the message function, and `seal` and `unseal` stay unexported. session.ts is 142 lines. `adminWalletEnv` checks the key against BASE58_KEY and that it decodes to 32 bytes, so a string of forty "1"s (valid alphabet, 40 bytes) is refused.
- Task 2: session route order is sameOrigin, then rateLimited("admin-session", 10 per 10 min), then json. A replayed nonce answers 401 bad_signature. A DB failure logs only the error code and answers 503. The `[op]` route answers 403 cross-origin, 401 without a valid cookie, 429 from rateLimited(`admin:${op}`, 60/min, wallet), and 404 not_found for an op not in OPS. The lookup uses `Object.hasOwn`, so `__proto__` or `constructor` is never treated as an op.
- Task 3: `admin-signin.e2e.ts` passes 5 of 5, with none skipped, on two runs. `curl /admin | rg noindex` matches on the dev server. Nothing outside the admin files links to /admin. The web build lists `/admin`, `/api/admin/[op]` and `/api/admin/session` as dynamic, and `check:bundle` passes. I checked screenshots of the sign-in card and the console at 390, 768 and 1440 (scratch only, not committed). The top bar stacks below 768px.

## Verification

- `pnpm vitest run apps/web/lib/session.test.ts`: 9 passed
- `pnpm exec playwright test apps/web/e2e/admin-signin.e2e.ts --project=chromium`: 5 passed
- `pnpm typecheck`: pass
- `pnpm lint`: clean (326 files)
- `pnpm --filter @bondr/web build` and `pnpm check:bundle`: pass
- `pnpm test`: 60 files passed, 453 tests passed, 2 skipped, 0 failed (388 s)

## Deviations from Plan

None that change behavior. Small calls:

- Fault lines use the existing `Callout variant="error"` (CircleAlert, role alert, danger wash). consent-dialog's `Fault` is private and looks the same, so I did not export it or copy it.
- The Refresh control and "Loaded {HH:MM}" from the UI-SPEC top bar are left out. They depend on the overview load, which a later plan adds.
- `session.test.ts` touches no database, so the vitest `DB` list is unchanged.

## Requirements

ADMIN-01 is not marked complete. This plan delivers the sign-in and the 30-minute session. The fresh signature for every money move ships with the intent plans (06-05 onward).

## For the next plans

- Playwright no longer needs `--grep-invert admin-signin`. No script or CI file in the repo referenced that flag.
- To add an op, put an entry in `OPS` in `app/api/admin/[op]/route.ts`. Each handler gets `(body, s)`, and the actor sent to the worker must be `s.wallet`. The rate limit is 60 per minute for every op today. RESEARCH Code Example 6 suggests 30 for `health`, so adjust it when health lands.
- Panels go inside `<AdminConsole>` as children and call `useAdmin().onUnauthorized()` on any 401. That swaps the console for the session-ended card.
- The admin-session rate limit is 10 per 10 minutes per IP. The API helper `adminSignIn` in phantom.ts uses a random X-Real-IP, but sign-ins through the card share the runner's IP.

## Self-Check: PASSED

- FOUND: apps/web/app/api/admin/session/route.ts, apps/web/app/api/admin/[op]/route.ts, apps/web/app/admin/page.tsx, apps/web/components/admin-signin.tsx, apps/web/components/admin-console.tsx
- FOUND: commits b8f6348, de2aea9, 5664087
