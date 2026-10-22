---
phase: 02-launch-flow
plan: 17
subsystem: ui-review
tags: [playwright, axe, design-review, screenshots, staging, devnet]
requires:
  - phase: 02-16
    provides: staging at https://web-staging-72bad.up.railway.app (web public, worker private, devnet)
provides:
  - "apps/web/e2e/responsive.e2e.ts: 12 surfaces x 390/768/1440, scroll + axe + screenshot, plus a 320 header check"
  - "36 local and 33 staging screenshots in .planning/phases/02-launch-flow/screenshots/"
  - "Designer critique 30/40 and audit 17/20 with three blockers fixed locally"
affects: [02-18]
tech-stack:
  added: []
  patterns:
    - "E2E_COIN_MINT overrides the coin surface's mint for runs against staging"
    - "e2e postgres clients use idle_timeout instead of end() in afterAll (fullyParallel revisits)"
key-files:
  created:
    - apps/web/e2e/responsive.e2e.ts
  modified:
    - apps/web/e2e/README.md
    - apps/web/app/globals.css
    - apps/web/components/wallet-button.tsx
    - apps/web/components/chrome.tsx
    - apps/web/components/proof-stamp.tsx
key-decisions:
  - "No code fix for the lookup table slot bug in this plan: it only reaches staging through a redeploy, which was not approved here"
  - "Staging rows left in place: the only wallets row is the sim dev launcher, which owns both failed launch rows; no generated test-wallet rows reached staging"
status: partial
completed: 2026-10-22
---

# Phase 2 Plan 17: UI Review Matrix and Staging Launch Summary

**The local half is done: 36 of 36 surfaces are clean, with critique at 30/40 and audit at 17/20, and three blockers were fixed. On staging, 33 of 36 surfaces pass with 0 axe violations and no horizontal scroll. The real staging launch did not land. On current devnet, the worker's lookup table create fails preflight with "N is not a recent slot", nothing is sent, and no landed mint exists for the staging coin page. Fixing it needs a code change plus a staging redeploy, and that is open for 02-18.**

## Staging launch (Task 1, staging half): NOT LANDED

The command was `E2E_DEVNET=1 E2E_BASE_URL=https://web-staging-72bad.up.railway.app pnpm exec playwright test apps/web/e2e/launch-live.e2e.ts -g devnet --project chromium`. I used the chromium project only, so paused.e2e.ts never flips the staging kill switch.

| Attempt (UTC) | Result |
|---|---|
| 16:48:13 | Consent POST got **429**. The Mac's public IP had already used its 10-per-10-minute consent bucket: the 02-16 WR-03 probe sent 12 curl POSTs at 16:46:36-41, and the last 2 got 429. Nothing was built. |
| 16:48:46 | My wait loop broke under zsh, so this attempt fired at once and got the same 429. No spend. |
| 16:57:25 | Consent 204, pin done (`CID bafk…qblu`). Prepare got **500**. Worker log: `prepare build failed: lookup table 5v36i6FC…: Simulation failed … "513952089 is not a recent slot" … InvalidInstructionData`. The UI showed "Could not build your launch transaction. Nothing was sent. Try again." |
| 17:01:57 | Same failure: table `2ymYGGXg…`, `513953223 is not a recent slot`. I stopped retrying. |

- **Mint:** `CyR56jVfHjPydeTpqC3TFiFqDMLEYUFLHWVZWtxPbndr`, reserved for the sim dev and reused by both attempts. It has no signature, and both launch rows are `failed`.
- **Root cause:**
  - `freshSlot` in `packages/core/src/alt.ts` takes `getSlot("finalized")` as the table's `recentSlot`.
  - Preflight runs on the `confirmed` bank, because `connect` builds `new Connection(url, "confirmed")`.
  - Devnet finality now runs 2 to 4 slots behind processed. Five samples at 17:01 showed gaps of 2 to 4. At 17:00:49, finalized equalled confirmed.
  - Slot 513952089's blockTime is 16:57:38, one second before the prepare. So the "finalized" slot can be the simulating bank's own slot, or one it has not reached yet, and SlotHashes never holds either. Under these conditions the failure is deterministic, not a flake.
  - No prior run hit this. Local devnet launches are probably affected the same way now, since they use the same code and Helius.
- **Suggested fix (for 02-18 or a gap plan):** choose `recentSlot` strictly below the confirmed bank. One option is the newest block from `getBlocks(tip - 32, tip - 1)`, where tip is `getSlot("confirmed")`. Keep the `usedSlot` monotonic check. A plain `slot - 1` can land on a skipped slot, which fails the same way.
- **Ops balance:**
  - Before: 2.898989 SOL. After: 2.860073 SOL.
  - The only movement is the beforeAll top-up of 0.038911 SOL to the sim dev, which went from 0.021089 to 0.060000.
  - Prepare rejections send nothing. The ops floor (2.40) is untouched, and the sim dev is funded for the next attempt.
- **Signature:** none, because nothing was sent. There are no Solscan links.

## Staging matrix (Task 1, staging half)

The command was `E2E_BASE_URL=<staging> pnpm exec playwright test apps/web/e2e/responsive.e2e.ts --project chromium --workers 2`. Two workers keep the run under the quote limit of 60 per minute per IP, because every request comes from one real IP on staging.

- **Result:** 34 passed, 3 failed.
  - Every non-coin surface passes at all three widths (33 of 33): 0 axe violations and no horizontal scroll.
  - The header-at-320 check passes.
  - **coin** fails at 390, 768 and 1440 because no staging launch landed. `E2E_COIN_MINT` was unset, so the spec read the dev branch's newest mint, which staging does not know. That leaves 3 of the 36 `-staging` PNGs missing.
- **Screenshots:** 33 `*-staging.png` files are committed. Each has the same pixel height as its local counterpart.
- **Differences from the local shots:**
  - **The 390 header fix is already on staging.** This contradicts the expectation in the brief. 6121b2b (01:05 IST, 10-22) predates the staging web deploy e977df47 (22:11 IST, 10-22), and the staging HTML carries the sr-only " Phantom" split. The 390 header on staging matches local, so 02-18 needs no redeploy for it.
  - **`launch-step5-390-staging.png` shows the hero art area blank.** At 768 and 1440 the art renders, and `/_next/image?url=/art/hero-bond-960.jpg` answers 200 image/jpeg on staging. This is a capture race with the first, cold optimizer response, not a product bug. The spec could wait for `img` decode before the shot (02-18, optional).

## Staging rows

- I took a baseline before any run: staging had 0 wallets and 0 launches.
- **After the runs:**
  - One wallets row, `9Hm1…wQM6`. This is the sim dev, the launcher of the real launch attempt.
  - Two `failed` launch rows, both for that wallet.
- **Removed: nothing.** No generated test-wallet rows reached staging. The consent surface is never accepted, and the matrix's other surfaces are stubbed.
- The sim dev row is not a generated test wallet, and the failed launches reference it, so it stays.
- The launch-form cleanup gap from 02-16 did not come into play, because launch-form was not run against staging here.

## Local half (folded in from the local notes, run 2026-10-22, no SOL spent)

### Task 1: responsive and axe matrix (local)

- **What `responsive.e2e.ts` covers:** 12 surfaces at 390, 768 and 1440: launch-step1, launch-step2, launch-step2-errors, launch-step3, launch-step4, launch-step4-rejected, launch-step5, launch-paused, consent, terms, coin and coin-404.
- **What each test does:** it asserts scrollWidth equals clientWidth, then runs AxeBuilder and expects 0 violations. It then saves `{surface}-{width}.png`, with a `-staging` suffix when `E2E_BASE_URL` is set. One extra test checks that the devnet header fits at 320.
- **How states are reached:**
  - Steps 4, 4 rejected and 5 use the launch-live stubs.
  - The paused state stubs `/api/status` with `paused: "kill_switch"`.
  - Consent uses a fresh, never-accepted wallet.
  - The coin surface reads the newest landed launch from the dev branch, or takes `E2E_COIN_MINT` when set.
- **How shots are taken:** reduced motion, scrolled to the top, the dev-only `nextjs-portal` hidden and the mouse parked. Consent is captured at viewport size because its sheet is fixed.
- **Result:** 36 of 36 clean locally, with 36 local PNGs.

### Task 2: Designer critique and audit

**Critique (Nielsen heuristics): 30/40, Good.**

| # | Heuristic | Score | Note |
|---|---|---|---|
| 1 | Visibility of system status | 4 | Five sign rows, live receipt, paused callout |
| 2 | Match with the real world | 3 | "Creator of record" and "bond" lean on the receipt |
| 3 | User control and freedom | 3 | No cancel after send, by design (D-16) |
| 4 | Consistency and standards | 3 | Link underlines fixed |
| 5 | Error prevention | 4 | Disabled CTAs say why |
| 6 | Recognition over recall | 3 | Receipt keeps every choice visible |
| 7 | Flexibility and efficiency | 2 | Preset chips only |
| 8 | Aesthetic and minimalist design | 3 | Matches round 2 mockups |
| 9 | Error recovery | 3 | One action per failure |
| 10 | Help and documentation | 2 | Inline hints and terms only |

**AI-slop verdict:** pass. The impeccable detector CLI is not installed, and it was not fetched with npx. The axe matrix and a manual component read stand in for it.

**Audit: 17/20, Good.**

| Dimension | Score | Note |
|---|---|---|
| Accessibility | 4 | 0 violations across all 36 surface-widths |
| Performance | 3 | The fixed grain overlay and header backdrop blur cost paint on low-end phones |
| Responsive | 4 | Was 3 before the header fix |
| Theming | 3 | Some inline color-mix values |
| Anti-patterns | 3 | None beyond the approved glow language |

**Blockers fixed:**

1. **The devnet header overflowed below 406px.** Below `sm`, the wallet button now reads "Connect", with " Phantom" as sr-only text. The wordmark hides below 360px, and the link keeps `aria-label="BONDR home"`. Files: `apps/web/components/wallet-button.tsx` and `chrome.tsx`. Check: "the header fits at 320".
2. **The proof label was muted instead of accent.** It is now `text-leaf`, caption caps at 600 weight. The "0" stamp weight moved from 900 to 800. File: `apps/web/components/proof-stamp.tsx`.
3. **Links had no underline after Tailwind preflight.** The base `a` rule now sets `text-decoration-line: underline`. File: `apps/web/app/globals.css`.

**Polish items for the owner (not fixed):**

1. The coin image is blank locally, because ipfs.io answers 429 to this machine. It is still unchecked on staging, since no launch landed there.
2. With Phantom missing, the step 3 button is disabled and nothing explains why. Suggestion: `popoverTarget="wallet-missing"`.
3. On mainnet, the mobile header has room for the full "Connect Phantom" label.
4. Below the minimum dev buy, the step 2 exit cards show "…" instead of a quote.
5. The step 2 field-error icon is a circle; the mockup uses a triangle.
6. The footer Program link is now underlined; the mockup leaves it plain.
7. Step 4 shows a double hairline under row 5. The mockup has the same.
8. At 390, the full mint wraps over three lines in the contract address row.

### Local test counts after the fixes

- responsive: 37 passed.
- Full Playwright suite: 104 passed, 1 skipped (the devnet group).
- Vitest: 95 passed, 1 skipped.
- lint, typecheck, the web build and the client bundle gate: pass.

## Deviations from Plan

1. **[Rule 3, blocking, local] The CONNECTION_ENDED errors under fullyParallel.** These came from `sql.end()` in afterAll, so launch-form, coin, consent and responsive now use `idle_timeout: 5` instead (3725700).
2. **[Added, local] The 320 header check, the culprit list in scroll failures, and the `E2E_COIN_MINT` override.**
3. **[Blocked, staging] The staging launch did not land.** See the lookup table slot bug above. The verify chain's second and third commands failed: the devnet group, and coin x3 in the staging matrix. Code fix and redeploy are out of scope here (not approved), so no fix was attempted.
4. **[Environment, staging] The first two attempts hit the consent 429.** The 02-16 WR-03 probe had used the consent bucket for the shared public IP. Side effect: the 11th and 12th forged-header POSTs in that probe got 429. That suggests the edge overrides `X-Real-IP`, so forged values do not reset the limit. The probe's own record is in ad72f34.

## Open items

- **Blocker for the staging launch must-have:** fix `freshSlot` to choose a slot below the confirmed bank, then redeploy staging (owner approval). Rerun the devnet group, then `E2E_COIN_MINT=<mint>` responsive for the 3 coin shots.
- **Unchecked on staging:** the coin page and the coin image (IPFS gateway) will stay unchecked until a staging launch lands.
- **Optional:** wait for image decode in responsive.e2e.ts before the step 5 shot.
- **Not committed:** 18 local PNGs were modified at 13:05 local on 10-22 by a later local run, before this session. They are left uncommitted, so the owner can choose whether to keep them.

## Commits

- 3725700 Keep e2e database clients open across afterAll so revisited spec files can still query
- bb5bff2 Add the responsive and axe matrix for 12 surfaces at three widths with screenshots
- 6121b2b Fit the devnet header at 320, put the proof label in accent and underline links as the mockup does
- 4a004e2 Add the 02-17 local notes and let the staging matrix take the coin mint from E2E_COIN_MINT
- This summary commit: 33 staging screenshots, SUMMARY, and the local notes deleted

## Threat Flags

None. Both mitigations held: T-02-17-01 (ops stayed above the floor, and the failed prepares sent nothing) and T-02-17-02 (screenshots show devnet test data only).

## Self-Check: PASSED (with the open blocker above)

- 02-17-SUMMARY.md exists; 33 `*-staging.png` exist; commits 3725700, bb5bff2, 6121b2b, 4a004e2 are on phase-02-launch-flow.
