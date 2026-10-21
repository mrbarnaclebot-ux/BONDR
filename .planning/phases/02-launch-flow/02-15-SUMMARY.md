---
phase: 02-launch-flow
plan: 15
subsystem: web
tags: [token-page, proof, server-component]
requires:
  - phase: 02-13
    provides: launchByMint (landed only), ProofStamp, CaRow, TxLink, lib/format
  - phase: 02-14
    provides: Sentry and the address scrub
provides:
  - "/coin/[mint]: server-rendered bare token page (identity bar, proof stamp, CA row, Phase 2 note), force-dynamic"
  - "/coin/[mint] not-found: No BONDR coin here, HTTP 404, Launch a coin"
  - "components: coin-identity (server), copy-chip (client)"
  - "ca-row.tsx exports useCopy and manualHint; the CA address span has id ca-address"
  - "lib/format.ts age(iso, now)"
  - "globals.css: animate-drift (bleed) and animate-live (live dot)"
affects: [02-16, phase-03]
tech-stack:
  added: []
  patterns:
    - "Mint param checked against base58 32-44 before any query; React cache() shares one read between generateMetadata and the page"
    - "e2e DB fixtures on a fake mint: vanity_mints row with used_at set (never handed out), launch row, both deleted in afterAll"
key-files:
  created:
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/app/coin/[mint]/not-found.tsx
    - apps/web/components/coin-identity.tsx
    - apps/web/components/copy-chip.tsx
    - apps/web/e2e/coin.e2e.ts
  modified:
    - apps/web/components/ca-row.tsx
    - apps/web/components/README.md
    - apps/web/e2e/README.md
    - apps/web/lib/format.ts
    - apps/web/lib/format.test.ts
    - apps/web/app/globals.css
key-decisions:
  - "Coin image is a CSS background, not next/image: ipfs.io answers 429 to this machine, and through the optimizer one server IP would fetch for every visitor and a failure would show a broken-image glyph"
  - "The copy chip shows 8 characters, so its manual-copy fallback selects the full address in the CA row (#ca-address)"
  - "Links render only when https (rules.ts already normalized them at pin time); website text is the URL host"
requirements-completed: [LAUNCH-05, PLAT-04]
duration: ~40 min
completed: 2026-10-22
---

# Phase 2 Plan 15: Bare token page Summary

**Open {SYMBOL} now lands on /coin/{mint}: a server-rendered page with the avatar bleed, name and symbol, a meta row (copy chip, On curve tag, age, links), the "Dev holds 0 launch supply" proof with the deployer's short address and the launch tx, and the full contract address with Copy. Unknown, malformed and unlanded mints get "No BONDR coin here" with HTTP 404.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Token page e2e, landed-only lookup and the not-found state | 58100eb |
| 2 | Identity bar, copy chip, proof and contract address | 8d4b144 |

## Verification

- `pnpm exec playwright test apps/web/e2e/coin.e2e.ts`: 10 passed.
  - **404 group:** a random base58 mint, `not-a-mint`, a failed-only mint and a prepared-only mint.
  - **Found group:** the newest landed devnet launch (`9i3M…bndr`, EY8TNO, burn). It checks the title, the h1, the proof label and headline, the sentence starting `Deployer 9Hm1…wQM6 chose insta burn:`, the tx href with `cluster=devnet`, the full mint, the copy chip writing the mint to the clipboard, the Phase 2 note, and links absent when not set. A throwaway landed row checks the X, Telegram and website links with `rel=noopener`. There is no horizontal scroll at 390, 768 or 1440, and the copy chip is at least 44 px tall at 390 and 32 px at 768 and 1440.
  - RED was observed before implementation: all 10 failed.
- **Full Playwright suite:** 67 passed, 1 skipped (the devnet launch group without E2E_DEVNET).
- **Vitest:** 95 passed, 1 skipped. New: the `age` test.
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build` (`/coin/[mint]` is dynamic) and `scripts/check-client-bundle.sh` all exit 0.
- **axe-core:** 0 violations at 390, 768 and 1440 on the burn coin, the sell coin (`APrD…bndr`) and the not-found page, with reduced motion on.
  - Screenshots are in `/private/tmp/claude-501/-Users-uzi-Documents-Git-Projects-nosync-BONDR/d687734b-6449-4b7a-b964-43fdb973692f/scratchpad/shots/token-*.png`. They were taken with ipfs.io stubbed by a local image, because of the 429.
- **Acceptance greps:** `notFound()` is in page.tsx, page.tsx has no `"use client"`, `ProofStamp` and `CaRow` are in page.tsx, and the `landed` filter is in launchByMint.
- **File sizes:** coin-identity 84, copy-chip 33, ca-row 73, page 55, coin.e2e.ts 154 lines.
- **Fixture cleanup:** confirmed. 0 launch rows with `w = 'e2e'` and 0 vanity rows below idx -2^60 remain after the run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Coin image through next/image showed a broken-image glyph**
- **Found during:** Task 2 screenshots.
- **Issue:** ipfs.io (and dweb.link) answer 429 to this machine. The optimizer then fails and the avatar shows Chrome's broken-image icon. Through the optimizer, every visitor's image fetch also comes from the one server IP.
- **Fix:** The avatar and the bleed use a CSS background with the gateway URL, so a failed load leaves the surface-2 block. The CID is checked as alphanumeric before it goes into `url()`. A `ponytail:` comment names the upgrade path: next/image once a dedicated gateway is set.
- **Commit:** 8d4b144

**2. [Rule 2 - Reuse] The copy logic was shared instead of duplicated**
- **Change:** `ca-row.tsx` now exports `useCopy` and `manualHint`, and copy-chip uses them. ca-row.tsx was not in the plan's file list. CaRow's behavior is unchanged, and the launch-live e2e still passes.
- **Commit:** 8d4b144

**3. [Rule 3 - Blocking] Small changes outside the listed files**
- **Change:** `format.ts` gets `age()` and a test. `globals.css` gets the drift and live-dot keyframes. `e2e/README.md` lists the new spec.
- **Note:** `lib/launches.ts` needed no change: launchByMint already filtered to landed (02-13).

## Known Stubs

None. The stats, chart, trade panel and ledger are Phase 3 by plan, and the page says so in its note.

## Notes for later plans

- **02-16:** add the committed axe check for `/coin/[mint]` and its not-found page. The ad hoc run here found 0 violations.
- **Phase 3:** keep the route stable. Phase 3 should:
  - add the TOKEN-06 OG image
  - add the "Bonded, PumpSwap" tag state
  - move the image to next/image once a dedicated gateway is set (PINATA_GATEWAY is unset locally)

## Threat Flags

None beyond the plan's threat model:
- **T-02-15-01:** base58 shape check, then a parameterized drizzle query.
- **T-02-15-02:** React escaping, https-only links with `rel=noopener`, and an alphanumeric CID before `url()`.
- **T-02-15-04:** only landed rows render.

## Self-Check: PASSED

- **Files:** all created files exist.
- **Commits:** 58100eb and 8d4b144 are on phase-02-launch-flow.
