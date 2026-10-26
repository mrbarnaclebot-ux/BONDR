---
phase: 07-go-live
plan: 18
subsystem: web launch page (owner genesis variant)
tags: [genesis, launch-form, admin-cookie, ui]
requires: [07-17]
provides:
  - "/launch is force-dynamic and reads the bondr_admin cookie server-side; LaunchFlow takes ownerGenesis (boolean only)"
  - "Live.genesis: true for the owner while status.paused is genesis; the flow then reads paused null"
  - "prepare route forwards actor (admin.wallet) only from a valid admin cookie, spread last"
  - "step 4 resolves GENESIS_FAULTS first when genesis and renders Fault.link"
  - "ExitCard lock?: string (the pill); Streamflow passes 'Coming later', genesis Insta sell 'Not for genesis'"
affects: [07-21 fork rehearsal (the owner flow), 07-28..G-5 genesis launch on mainnet]
key-files:
  created:
    - apps/web/e2e/launch-genesis.e2e.ts
  modified:
    - apps/web/app/launch/page.tsx
    - apps/web/app/api/launch/prepare/route.ts
    - apps/web/components/launch-flow.tsx
    - apps/web/components/launch-sign.tsx
    - apps/web/components/launch-buy.tsx
    - apps/web/components/launch-review.tsx
    - apps/web/components/launch-receipt.tsx
    - apps/web/components/launch-coin.tsx
key-decisions:
  - "07-18: the genesis flag rides on Live (live.genesis) instead of a new prop on every step, because every step and the summary already take live"
  - "07-18: the review step hides the child fee split callout in genesis, because it contradicts the summary's single Creator fee group (D-31)"
requirements-completed: []  # OPS-05 needs the mainnet genesis launch (07-28+)
duration: 20min
completed: 2026-10-26
---

# Phase 7 Plan 18: Owner Genesis Page Summary

**The owner can now fill in and send the genesis launch from /launch, and everyone else still sees the "Launches are not open yet." banner. The page checks the admin cookie on the server and passes only a boolean down. The prepare route adds `actor` only from a valid admin cookie, spread after the body fields. The owner variant:**
- **Banner:** the "Genesis launch." info banner in place of the pause banner.
- **Step 1:** BONDR is accepted as the ticker.
- **Step 2:** Insta burn is preselected, Insta sell is locked with "Not for genesis", and the buy hint names the SOL buy.
- **Review:** shows Pair SOL and the treasury creator row, and drops "You after bond".
- **Summary:** shows Pair SOL and one "Creator fee" group.
- **Step 4:** shows the genesis copy for forbidden, not_ready (with an /admin link) and genesis_landed.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Server-side owner check, actor forward, banner, genesis step 4 copy | 11a4b52 |
| 2 | Owner variant in buy, review, summary and coin steps, with the e2e | 020d17e |

## Evidence

- Task 1: launch-paused.e2e.ts and launch-form.e2e.ts, 16 passed. `rg -n actor` on the prepare route shows `{ ...fields, wallet, ...(admin ? { actor: admin.wallet } : {}) }`. page.tsx has `force-dynamic`.
- launch-genesis.e2e.ts: 5 passed, with no case skipped. It signs in for real through `adminSignIn`, and the browser shares that cookie. The cases:
  - Without the admin cookie: the public banner shows, there is no info banner, and "Launches paused" is disabled at step 3.
  - Owner happy path:
    - The info banner shows and the ticker BONDR passes step 1.
    - Burn is checked and Insta sell is disabled with its pill and body. No buy error shows before input.
    - The genesis buy hint shows.
    - Review shows Pair SOL, the Exit row, and the creator row "The BONDR treasury Trea…1111. ...". There is no "You after bond" and no fee split callout.
    - The summary shows Pair SOL and one "Creator fee" group at 100%. The sign button is enabled.
  - Stubbed 403 forbidden, 503 not_ready and 409 genesis_landed each show their exact line, and row 2 is failed. not_ready carries an /admin link.
- launch-ticker.e2e.ts: still green (non-owners are still refused). The combined run of genesis, ticker, paused and form was 28 passed.
- Gate shots: launch-genesis-owner-buy and launch-genesis-owner-review at 390 and 1440 (axe and no horizontal scroll).
- Full `pnpm test` at the end of the 07-16..07-18 batch: 105 files, 816 passed, 2 failed, 2 skipped.
  - trades.test.ts failed on a Neon CONNECT_TIMEOUT.
  - env.test.ts hit a 0.6% flake that dates from 07-04 (logged in deferred-items.md).
  - Rerunning both files: 16 passed.
- `pnpm --filter @bondr/web typecheck` and `pnpm lint` are clean. Line counts: launch-buy 280, launch-review 147, launch-receipt 131, launch-coin 256, launch-flow 248, launch-sign 243.

## Deviations from Plan

1. **[Rule 1] The fee split callout is hidden in genesis review.** The screenshot showed the child callout ("90% builds a burn budget ..."), which is wrong for BONDR itself (D-31). The UI-SPEC review table did not cover it.
2. **[Rule 1] The early buy error is suppressed in genesis.** With burn preselected, the existing rule "a chosen exit shows the error at once" showed the minimum error before any input. In genesis the error now waits for input or blur.
3. **The `genesis` flag rides on `Live` instead of a prop threaded to each step.** LaunchFlow computes it once: owner and status paused genesis. Steps read `live.genesis`, and `live.status.paused` reads null for the owner, so the Launch button follows unchanged code.
4. **The actor forward has no unit test.** The prepare route imports `@/lib/*`, which the Vitest setup cannot resolve (carry note from 07-03). The e2e stubs /api/launch/prepare in the browser. The worker's actor checks are unit-tested in 07-16, and the forward line is visible in the route.
5. **Not changed:** the server-rendered lede ("One Phantom signature creates your coin ... 80% of them are yours") stays the same for the owner. The UI-SPEC does not cover it. The owner may want a genesis line there.

## Threat Flags

None new. T-07-18-01: FIELDS excludes actor, and actor is spread last from adminSession. T-07-18-02: adminSession is checked server-side, and the worker refuses non-admin wallets (07-16). T-07-18-03: only the boolean `ownerGenesis` crosses to the client. T-07-18-04: accepted (the bypass is UI-only; the worker refuses reserved tickers for child prepares).

## Self-Check: PASSED

- FOUND apps/web/e2e/launch-genesis.e2e.ts and 4 launch-genesis-owner shots
- FOUND commits 11a4b52, 020d17e
