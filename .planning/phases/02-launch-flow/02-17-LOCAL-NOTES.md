# 02-17 local notes (staging part pending)

Local half of plan 02-17, run 2026-10-22 while staging (02-16) is blocked by the Railway outage. The staging continuation folds this into 02-17-SUMMARY.md. Nothing here ran with `E2E_BASE_URL` or `E2E_DEVNET=1`, and no SOL was spent.

## Task 1: responsive and axe matrix (local)

- `apps/web/e2e/responsive.e2e.ts`: 12 surfaces at 390, 768 and 1440 (launch-step1, launch-step2, launch-step2-errors, launch-step3, launch-step4, launch-step4-rejected, launch-step5, launch-paused, consent, terms, coin, coin-404). Each one asserts scrollWidth equals clientWidth, runs AxeBuilder and expects 0 violations, then saves `.planning/phases/02-launch-flow/screenshots/{surface}-{width}.png` (with a `-staging` suffix when `E2E_BASE_URL` is set). There is one extra test: the devnet header fits at 320.
- Steps 4, 4 rejected and 5 use the launch-live stubs. The paused state stubs `/api/status` with `paused: "kill_switch"`. Consent uses a fresh test wallet that is never accepted, so no wallet row is written.
- Screenshots use reduced motion, scroll to the top first, hide the dev-only `nextjs-portal`, and park the mouse. The consent sheet is captured at viewport size because it is fixed to the viewport.
- Result: 36 of 36 surfaces have 0 axe violations and no horizontal scroll locally. 36 local PNGs are committed.

### For the staging continuation

- Set `SESSION_SECRET` on the staging web service before the next deploy (`openssl rand -base64 48`, a value of its own, never the local one). It keys the consent nonce and the wallet session cookie (CR-01). Without it `/api/consent` answers 500, no session is issued, and pin, prepare and submit refuse every wallet with consent_required. The worker needs nothing new.

- Run the devnet group first. Then run `E2E_BASE_URL=$STAGING_URL E2E_COIN_MINT=<the staging launch's mint> pnpm exec playwright test apps/web/e2e/responsive.e2e.ts`. Without `E2E_COIN_MINT`, the coin surface reads the newest landed launch from the root .env `DATABASE_URL`, which is the dev branch, so it would probably 404 on staging.
- The header fix below is not on staging yet. The staging shots at 390 will match only after a redeploy (02-18).

## Task 2: Designer critique and audit

### Critique (Nielsen heuristics), 30/40, Good

| # | Heuristic | Score | Note |
|---|-----------|-------|------|
| 1 | Visibility of system status | 4 | Five sign rows with sub-lines, a live receipt, a paused callout above the panel |
| 2 | Match with the real world | 3 | "Creator of record" and "bond" need the receipt and callout to explain them |
| 3 | User control and freedom | 3 | Back, Back to review and Try again; no cancel after send, by design (D-16) |
| 4 | Consistency and standards | 3 | Link underlines were inconsistent with the mockup (fixed) |
| 5 | Error prevention | 4 | Disabled CTAs say why ("Fix the dev buy", "Choose an exit to continue") |
| 6 | Recognition over recall | 3 | The receipt keeps every choice visible on every step |
| 7 | Flexibility and efficiency | 2 | Preset chips only; acceptable for a one-off flow |
| 8 | Aesthetic and minimalist design | 3 | Matches the approved round 2 mockups |
| 9 | Error recovery | 3 | Specific copy with one action per failure |
| 10 | Help and documentation | 2 | Inline hints and the terms page only |

AI-slop verdict: pass. The glows, grain and display face come from the approved brand, not from defaults. The impeccable detector CLI is not installed on this machine, and it was not auto-downloaded with npx, so the deterministic scan was replaced by the axe matrix and a manual read of the components.

### Audit, 17/20 after fixes, Good

| Dimension | Score | Note |
|-----------|-------|------|
| Accessibility | 4 | 0 axe violations x 36; live regions, focus moves and labels follow the UI-SPEC |
| Performance | 3 | CSS-only motion. A full-page fixed grain overlay plus the header backdrop blur cost paint on low-end phones |
| Responsive | 4 | Was 3: the devnet header overflowed below 406px (fixed) |
| Theming | 3 | Tokens are used throughout; some color-mix values are written inline in class strings |
| Anti-patterns | 3 | None beyond the approved glow language |

### Blockers fixed

1. **The devnet header overflowed below 406px.** At 320 and 360 the page scrolled horizontally (scrollWidth 390), and at 390 the wallet button ran into the right gutter. With fallback fonts this also caused a transient 404px scrollWidth in coin-404 at 390. This broke the UI-SPEC rule "no horizontal scroll from 320 up". Fix: below `sm`, the wallet button shows "Connect" (or "Opening…") with " Phantom" as sr-only text, so its accessible name is still "Connect Phantom". The BONDR wordmark hides below 360px; the link keeps `aria-label="BONDR home"`. Files: `apps/web/components/wallet-button.tsx`, `apps/web/components/chrome.tsx`. Check: `the header fits at 320` in responsive.e2e.ts.
2. **The proof label was muted instead of accent.** UI-SPEC accent item 5 and the mockup (`.proof .label { color: var(--accent) }`) both put it in accent. It is now `text-leaf`, caption caps at 600 weight with 0.09em tracking. The "0" stamp weight also moved from 900 to 800, the only display weight the UI-SPEC loads. File: `apps/web/components/proof-stamp.tsx`.
3. **Links had no underline.** The mockup's base `a` rule relies on the browser's default underline, and Tailwind preflight removes it. So the footer "Terms", the consent "terms", the launch tx links and the coin page links showed no underline, while the mockup shows one. The code already opts out with `no-underline` (brand, buttons, terms nav). Fix: `text-decoration-line: underline` on the base `a` rule. File: `apps/web/app/globals.css`.

### Polish items for the owner (not fixed)

1. The coin image is a blank block on the coin page, in the receipt and on step 5 locally, because ipfs.io answers 429 to this machine (02-15). The stubbed flows use a 1 x 1 green PNG. Check the image on staging.
2. If Phantom is not installed, the step 3 "Connect Phantom to launch" button is disabled and nothing in the panel says why. The only route to "Get Phantom" is the header popover. Suggestion: give the step 3 button `popoverTarget="wallet-missing"` when the status is `missing`.
3. On mainnet (no DEVNET badge), the mobile header has room for the full "Connect Phantom" label. The sr-only split could become devnet-only if the owner prefers the full label there.
4. Below the minimum dev buy, the step 2 exit cards show "…" for the quote. The mockup's error state still shows a quote for the low amount.
5. The step 2 field-error icon is a circle (alert); the mockup uses a triangle.
6. The footer "Program: pump 6EF8…F6P" link is now underlined, like every other text link. The mockup leaves it plain.
7. Step 4 shows a double hairline under row 5 (the row border plus the action-row rule). The mockup has the same.
8. At 390 the full mint wraps over three lines in the contract address row (step 5 and the coin page). It is readable, but the mockup's sample mint was shorter.

## Test counts (local, after fixes)

- responsive.e2e.ts: 37 passed (36 matrix + the header-at-320 check)
- Full Playwright suite: 104 passed, 1 skipped (the launch-live devnet group, which needs `E2E_DEVNET=1`)
- Vitest: 95 passed, 1 skipped
- lint, typecheck, `@bondr/web` build and `scripts/check-client-bundle.sh`: pass

## Deviations

- [Rule 3, blocking] With `fullyParallel`, a worker runs a file's `afterAll` when it moves to another file and reuses the module if it comes back. The `sql.end()` in `afterAll` then made the next query fail with CONNECTION_ENDED, which showed up in launch-form once the 36 new tests interleaved. Fix: `idle_timeout: 5` on the client and no `end()`, in launch-form, coin, consent and responsive. pin.e2e.ts already creates its client in `beforeAll`, and paused.e2e.ts runs alone in its own project.
- The matrix also has a 320 header check, the overflowing elements listed in the failure message, and the `E2E_COIN_MINT` override for the staging run.

## Commits

- 3725700 Keep e2e database clients open across afterAll so revisited spec files can still query
- bb5bff2 Add the responsive and axe matrix for 12 surfaces at three widths with screenshots
- 6121b2b Fit the devnet header at 320, put the proof label in accent and underline links as the mockup does
- this notes commit (with the E2E_COIN_MINT override)
