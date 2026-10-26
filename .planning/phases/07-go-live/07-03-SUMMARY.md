---
phase: 07-go-live
plan: 03
subsystem: web
tags: [terms, copy, proxy, domain]
requires: []
provides:
  - "Terms page: hello@trybondr.fun mailto (section 08), the mainnet sentence (01), the 24h ticker cooldown sentence (04)"
  - "TERMS_VERSION 2026-10-26 (one bump)"
  - "apps/web/proxy.ts: www to apex 308 built from SITE_URL, then READ_PATHS rate limit; matcher covers every non-static path"
  - "apps/web/proxy.test.ts (unit project)"
affects: [07-26 production domains, admin SIWS domain line, consent text]
key-files:
  created:
    - apps/web/proxy.test.ts
  modified:
    - apps/web/app/terms/page.tsx
    - apps/web/lib/terms.ts
    - apps/web/e2e/terms.e2e.ts
    - apps/web/proxy.ts
    - apps/web/README.md
key-decisions:
  - "07-03: the redirect host comes from x-forwarded-host, then host; only an exact www. plus SITE_URL host match redirects, and the Location is built from SITE_URL alone"
  - "07-03: existing consents are not re-asked after the TERMS_VERSION bump; no lookup compares termsVersion, new consents record 2026-10-26"
requirements-completed: []
duration: 20min
completed: 2026-10-26
---

# Phase 7 Plan 03: Terms Go-Live Copy and the www Redirect Summary

**The terms page now names hello@trybondr.fun, says BONDR runs on mainnet with a separate devnet test copy, and states the 24h ticker cooldown, all under one TERMS_VERSION bump to 2026-10-26. www.trybondr.fun answers 308 to SITE_URL before any rate limit. The limit still covers only the seven read paths.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Terms contact, network and cooldown sentences under one version bump | 34ccc90 |
| 2 | www to apex redirect ahead of the unchanged rate limit | bff712a, 4f96593 (README) |

## Evidence

- terms.e2e.ts (chromium): 7 passed. A new test asserts the mailto link and its href, the section 01, 04 and 08 sentences, and the "Last updated 2026-10-26" line, and checks that the placeholder is gone.
- `rg "@BONDR on X" apps/web`: no match. "being tested it runs on Solana devnet": gone. TERMS_VERSION changed once (2026-10-19 to 2026-10-26).
- Pitfall 21: `termsVersion` is only written (`app/api/consent/route.ts`). The worker's consent check counts the wallet row, and nothing compares versions, so existing consents stay valid and are not re-asked. New consent signatures name version 2026-10-26.
- proxy.test.ts: 4 passed. Red was checked against the old proxy, loaded with a relative import: the www case and the scope case failed, because the old function limits /launch when the matcher is widened, which is Pitfall 16.
- Regression: live.e2e.ts, home-live.e2e.ts and terms.e2e.ts: 22 passed, 1 skipped (that skip was already there).
- `pnpm --filter @bondr/web typecheck`, `pnpm lint`: clean. proxy.ts is 40 lines.

## Deviations from Plan

1. **[Rule 3 - Blocking] proxy.ts imports `./lib/guard`, not `@/lib/guard`.** Vitest has no `@/` alias, so the unit test could not load the proxy. The relative import is the same module for Next.
2. **The cooldown sentence sits right after "...impersonate someone.", as the spec says.** The existing "BONDR may hide a coin..." sentence now follows it.
3. **The placeholder absence check is a regex (`/@BONDR\s+on X/`).** With a literal string, the plan's own `! rg "@BONDR on X" apps/web` verify would match the test file.
4. **[Docs] The apps/web/README.md proxy line now describes the redirect and READ_PATHS.**

## Notes for later plans

- The owner must set up hello@trybondr.fun forwarding (D-17, non-money) before go-live. If a different address is chosen, change it in page.tsx and terms.e2e.ts together.
- The redirect needs SITE_URL=https://trybondr.fun on the production web service and www.trybondr.fun added as a custom domain (07-26 runbook).

## Threat Flags

None. The redirect is exact-match only, and the Location never carries a host from the request (T-07-03-01, tested with forged x-forwarded-host values).

## Self-Check: PASSED

- FOUND apps/web/proxy.test.ts
- FOUND commits 34ccc90, bff712a, 4f96593
