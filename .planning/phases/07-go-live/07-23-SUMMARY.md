---
phase: 07-go-live
plan: 23
subsystem: web UI verification (Phase 7 responsive and axe matrix, Designer review)
tags: [responsive, axe, screenshots, designer, ui-review]
requires: [07-03, 07-07, 07-14, 07-18]
provides:
  - "apps/web/e2e/golive-responsive.e2e.ts: 17 states x 390/768/1440 through gate, 51 golive-*.png shots in PHASE7_SHOTS"
  - "shoot.ts gate(page, name, width, dir, el?): optional element shot (the owner summary panel)"
  - "playwright.config.ts RESPONSIVE is an array (admin-responsive + golive-responsive) in the admin-responsive project"
  - "LaunchFlow genesisIntro: the owner genesis lede replaces the child lede once live.genesis is true"
affects: [07-28 genesis launch (the owner sees the genesis lede)]
key-files:
  created:
    - apps/web/e2e/golive-responsive.e2e.ts
    - .planning/phases/07-go-live/screenshots/golive-*.png (51)
  modified:
    - apps/web/e2e/shoot.ts
    - playwright.config.ts
    - apps/web/app/launch/page.tsx
    - apps/web/components/launch-flow.tsx
    - apps/web/e2e/launch-genesis.e2e.ts
key-decisions:
  - "07-23: the matrix runs in the admin-responsive project, because its admin states sign in as the one admin wallet (health 60/min)"
  - "07-23: the genesis lede is a second server-rendered intro passed only to the owner and shown when live.genesis, so the client bundle gets no copy and non-owners never see it"
requirements-completed: []  # UI proof only; OPS-05, OPS-02, LAUNCH-08 and LAUNCH-09 close in later plans, TOKEN-07 was already ticked
duration: 50min
completed: 2026-10-26
---

# Phase 7 Plan 23: Responsive Matrix and Designer Review Summary

**All 17 Phase 7 states pass at 390, 768 and 1440 through `gate`: no horizontal scroll, 0 axe violations, a screenshot each, 51 in all. Below 768px, the new controls are at least 44px tall. The controls checked are "Run check now", the genesis Insta sell card, and the controls in the step 4 refusal callout. The Designer review found one blocker: the owner genesis /launch lede still showed the child-launch lede. It now has its own genesis lede.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | The Phase 7 responsive and axe matrix | 9895dc8 |
| 2 | Designer critique and audit fix: genesis lede, polled 44px check | 7c40601 |

## States (golive-{state}-{390,768,1440}.png)

- **Launch:**
  - launch-genesis-public
  - launch-contract-paused
  - launch-genesis-owner-buy
  - launch-genesis-owner-review
  - launch-genesis-owner-summary (the receipt panel as an element shot)
  - launch-tip-summary
  - launch-ticker-locked-step4
  - launch-ticker-field
  - launch-reserved-field
- **Seeded:** search-first, coin-sniped.
- **Admin:**
  - admin-contract-passed
  - admin-contract-redeployed
  - admin-contract-mismatch (with the Kill switches callout)
  - admin-contract-failed
  - admin-genesis-callout
- **Terms:** terms-contact.

## Designer review (critique + audit against 07-UI-SPEC)

This executor had no Agent or Skill tool, so it ran the Designer role inline. It read the screenshots, and crops of the tall admin pages, against 07-UI-SPEC surfaces 1 to 7 and A1 to A5. Scores are out of 5.

| Surface | Score | Notes |
|---------|-------|-------|
| Public genesis banner | 5 | The title and body match surface 1 verbatim. The warn callout sits in the right slot, and Continue still works. |
| contract_check banner | 5 | Matches the spec verbatim and says "Trading is not affected." |
| Owner genesis, step 2 | 4 then 5 | The info banner, burn preselect, Sell card lock with the "Not for genesis" pill and body, and the buy hint all match. Blocker found: the page lede read "...sells or burns it... After bond, 80% of them are yours, permanently", which is false for genesis (no sell, treasury creator, no W). Fixed. |
| Owner genesis, step 3 | 4 then 5 | The Pair, Exit and Creator of record rows match, and "You after bond" is gone. It had the same lede blocker. Fixed. |
| Owner genesis summary | 5 | Pair SOL, Exit Insta burn, a single Creator fee group at 100%, and "none, burned". |
| Sender tip row | 5 | "about 0.001 SOL" is in the spec's order. |
| Ticker refusal, step 4 | 5 | A1 copy, an error callout, and no retry button. |
| Ticker field and reserved field | 5 | A1 and A2 FieldError copy, aria-invalid, and the red ring. |
| Search First marker | 5 | The plain Tag at 390 stays on one row, and the name truncates (A3). |
| Sniped line | 5 | Plain text after the proof, with no protection wording (the spec asserts it). |
| Admin contract cell, all states | 5 | The leaf, warn and destructive value tones and the dot match. "Run check now" is 44px below 768. |
| Mismatch and genesis callouts | 5 | Mismatch comes first, then genesis, then the fee engine notice. |
| Terms contact | 5 | Section 08 has the mailto link. |

### Fix built

The genesis lede, a deviation I added on the orchestrator's instruction. UI-SPEC has no lede line for genesis, so the copy follows surface 2's banner and the review rows: "One Phantom signature creates the BONDR token, makes your dev buy, and burns it in the same transaction. Its creator fees go to the BONDR treasury and are claimed on pump.fun."
- How it works: page.tsx renders it server side only for an admin session (`genesisIntro`). LaunchFlow shows it instead of `children` once `live.genesis`, which means owner plus status paused genesis.
- Non-owners, and an owner outside genesis mode, keep the child lede.
- launch-genesis.e2e.ts now asserts both ledes.
- The 07-18 shots launch-genesis-owner-buy and launch-genesis-owner-review (390, 1440) were re-rendered with the new lede. They are committed.

### Not built (non-blocking suggestions)

- In the matrix, the admin-contract-mismatch shot shows the five switches as RUNNING under a callout that says every job was paused. Only `health.contract` is stubbed, while the switches come from the real worker. In production, a mismatch turns them off (D-20). A future matrix could stub the switches off too.
- Step 4 labels the failed build row "Transaction built" with a red mark. This is an existing Phase 2 pattern, not a Phase 7 surface.
- The genesis lede swaps in after the first status load, the same moment the info banner appears. That is acceptable, because both arrive together.

## Evidence

- The matrix passed three times. The first run went through `pnpm exec playwright test apps/web/e2e/golive-responsive.e2e.ts`, which also ran the whole chromium dependency: 362 passed, 21 skipped. The two runs after the fix used `--project=admin-responsive --no-deps` and were 14 passed each.
- 51 golive PNGs exist, 17 at 390.
- launch-genesis, launch-form and launch-paused: 21 passed.
- `pnpm typecheck` and `pnpm lint` exited 0.
- Re-rendered shots of other phases and other Phase 7 specs were restored with git checkout.

## Deviations from Plan

1. **[Rule 1 - Bug, orchestrator-directed] The genesis lede** (above).
2. **The 44px check now polls the height.** In one run it read 24px right after a resize to 390, with md: still applied. The ≥44 bound is unchanged.
3. **`gate` has an optional element argument** for the summary state, because a full-page shot of step 3 cannot show the summary as its own surface.
4. **The Designer role ran inline** (no Agent or Skill tool was available to this executor), not as an opus subagent with the critique and audit skills.

## Known Stubs

None.

## Self-Check: PASSED

- apps/web/e2e/golive-responsive.e2e.ts exists, and 51 golive shots exist.
- Commits 9895dc8 and 7c40601 are in the log.
