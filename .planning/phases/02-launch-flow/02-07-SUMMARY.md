---
phase: 02-launch-flow
plan: 07
subsystem: web-launch-form
tags: [launch-form, validation, shadcn, rules, stepper]
requires: [02-01, 02-05, 02-06]
provides:
  - "/ redirects to /launch (temporary, ponytail until the Phase 3 home lists)"
  - "/launch: Display h1, lede, five-node bond-chain stepper, one step panel with an sr-only focus heading"
  - "components/ui-button.tsx: Button and buttonVariants (primary, quiet, solid, danger; default, lg; asChild via radix-ui Slot)"
  - "components/ui-field.tsx: Input, Textarea, Label (optional marker), FieldError"
  - "lib/cn.ts: cn() (clsx plus tailwind-merge)"
  - "components/launch-flow.tsx: useReducer state machine (step, fields, image, devBuy, exit, launchId, cid), types Launch, Action, StepProps, Fields, LinkKey, Picked, and a BODIES map that later plans fill for steps 2 to 5"
  - "components/launch-stepper.tsx: LaunchStepper and STEP_NAMES"
  - "components/launch-coin.tsx: step 1 Coin, every check through @bondr/core/rules with the UI-SPEC copy"
  - "components/launch-drop.tsx: image drop zone (click, keyboard, drag and drop, magic bytes, decode for dimensions)"
affects: [02-08, 02-10, 02-13, 02-18]
tech-stack:
  added:
    - "class-variance-authority@0.7.1"
    - "clsx@2.1.1"
    - "tailwind-merge@3.7.0"
    - "radix-ui@1.6.7"
  patterns:
    - "shadcn components hand-ported into flat files (ui-*.tsx); the CLI is never run"
    - "Each step body is a StepProps component registered in BODIES; the flow owns the panel, the sr-only h2 and the focus move"
    - "Field errors: over-limit and charset errors show live, required waits for blur or Continue, link errors wait for blur and clear on edit"
    - "The server-rendered h1 and lede are passed into the client LaunchFlow as children"
key-files:
  created:
    - apps/web/lib/cn.ts
    - apps/web/components/ui-button.tsx
    - apps/web/components/ui-field.tsx
    - apps/web/app/launch/page.tsx
    - apps/web/components/launch-flow.tsx
    - apps/web/components/launch-stepper.tsx
    - apps/web/components/launch-coin.tsx
    - apps/web/components/launch-drop.tsx
    - apps/web/components/README.md
    - apps/web/e2e/launch-form.e2e.ts
  modified:
    - apps/web/package.json
    - pnpm-lock.yaml
    - apps/web/next.config.ts
    - apps/web/components/wallet-button.tsx
    - apps/web/components/consent-dialog.tsx
    - apps/web/e2e/wallet.e2e.ts
  deleted:
    - apps/web/components/btn.ts
decisions:
  - "Hand-ported shadcn 4.21.2 button, input, textarea and label instead of running the CLI (D-21). This avoids an unpinned lucide-react and tw-animate-css, and the flat ui-*.tsx files keep the three-level rule"
  - "btn.ts is gone. wallet-button and consent-dialog now use buttonVariants and Button, so there is one source of button styles"
  - "The name counter shows UTF-8 bytes against 32 (A8); the over-limit copy keeps the UI-SPEC wording with n = bytes"
  - "An invalid file clears the previous image, rather than leaving a stale preview next to the error"
  - "An invalid field stays red while focused, as in the mockup, so the error never hides behind the focus color"
metrics:
  duration: ~25 min
  completed: 2026-10-19
  tasks: 2
  files: 17
---

# Phase 2 Plan 07: Launch page and step 1 Coin Summary

/ now redirects to /launch. That page shows the title, the lede and the bond-chain stepper, and step 1 works: name, symbol, image, description and the three links. Every field is checked in the browser with the same `@bondr/core/rules` module that the pin route and the worker will run. "Continue to dev buy" validates everything, shows the UI-SPEC copy and focuses the first invalid field. Valid input moves the stepper to step 2 and focuses "Step 2 of 5: Dev buy and exit".

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | UI primitives, /launch page, stepper and launch state machine | 1dbc5b3 |
| 2 | Step 1 Coin panel with drop zone, launch-form e2e | 4acb0b0 |

## Verification

- `pnpm vitest run`: 50 passed. `pnpm lint` and `pnpm typecheck` exit 0 after each commit. `pnpm --filter @bondr/web build` lists `○ /launch`.
- `pnpm exec playwright test apps/web/e2e`: 27 passed. That is launch-form 7, wallet 7 (one new) and consent 7, and terms 6.
- I wrote launch-form.e2e.ts before launch-coin.tsx. Six of its seven cases failed, as intended; the redirect and heading case already passed on the Task 1 page. Per the orchestrator, the red step was not committed.
- Acceptance greps: `"radix-ui": "1.6.7"` is in apps/web/package.json. No `tw-animate-css` or `components.json` in apps/web. `redirects` is in next.config.ts, `aria-current` in launch-stepper.tsx and `@bondr/core/rules` in launch-coin.tsx. components/README.md exists.
- `GET /` returns 307 to `/launch`.
- Screenshots at 390, 768 and 1440 were taken in the scratchpad and not committed. They cover empty, errors (Continue on an empty form, `ab-c`, a `javascript:` website) and filled with a long file name. They match launch.html step 1: two-column name and symbol, 88px drop avatar (64px below 640), three-column links, and the actions row with the hint on the left. The page has no element past the viewport edge at any of the three widths. Designer sign-off is at 02-18.

## Freshness (14-day cutoff 2026-10-05)

| Package | Published |
|---------|-----------|
| class-variance-authority 0.7.1 | 2024-11-26 |
| clsx 2.1.1 | 2024-04-23 |
| tailwind-merge 3.7.0 | 2026-09-12 |
| radix-ui 1.6.7 | 2026-07-24 |
| @radix-ui/react-slot 1.3.3, react-label 2.1.15 (and the other exact radix-ui deps) | 2026-07-24 |
| @floating-ui/core, dom, react-dom, utils (transitive) | 2026-07-11 |
| aria-hidden, react-remove-scroll(-bar), react-style-singleton, use-callback-ref, use-sidecar, detect-node-es, get-nonce (transitive) | 2020-04 to 2025-11 |

The shadcn CLI was not run. In the lockfile, the only change other than the new packages is the `utf-8-validate` peer suffix returning on the pump SDK and anchor snapshot keys. This is pnpm re-deriving peer contexts again (see 02-06), and no version changed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Replaced btn.ts with the ported Button**
- **Found during:** Task 1
- **Issue:** 02-05 left `btn.ts` as a stopgap ("02-07 ports the shadcn Button, then swap"). Keeping both would mean two sources of button styles.
- **Fix:** Deleted btn.ts. wallet-button.tsx uses `buttonVariants`, and consent-dialog.tsx uses `<Button>`. Neither file was in files_modified. With the inline `buttonVariants` calls, Biome reformatted ConsentPrompt to 45 lines, past the 40-line limit; using `<Button>` brought it back under.
- **Commit:** 1dbc5b3

**2. [AGENTS.md - file size] Drop zone in its own file**
- launch-coin.tsx with the drop zone would have neared 330 lines. The drop zone moved to `launch-drop.tsx`, and `FieldError` moved to `ui-field.tsx` so the two files do not import each other. launch-coin.tsx is 243 lines.
- **Commit:** 4acb0b0

**3. [Rule 1 - Bug] Invalid fields turned green on focus**
- The `focus:` border beat `aria-invalid:`. Continue focuses the first invalid field, so that field showed the accent instead of the danger border. Added `aria-invalid:focus:` overrides, which matches the mockup, where `[aria-invalid]` follows `:focus`.
- **Commit:** 4acb0b0

### Notes

- `apps/web/app/page.tsx` did not exist (02-01 chose no fallback page), so there was nothing to delete.
- The textarea allows 600 characters, not the mockup's `maxlength=500`, so the "Description is {n} characters" error can actually show. Name allows 40 and symbol 20, per the UI-SPEC.
- The file input is named by the "Image" caption (`aria-labelledby`) and described by the drop zone status text. The label wrapping it keeps click and keyboard picking, and the label shows the focus ring through `has-[:focus-visible]`.

## Notes for later plans

- 02-08: add `2: LaunchDevBuy, 3: LaunchReview` to `BODIES` in launch-flow.tsx. The receipt `aside` goes in the second grid column, where a comment marks its place. The grid is already `minmax(0,1fr) 400px` at 1080px. The reducer already has `devBuy`, `exit` and `go`. `state.image.url` is a blob URL for the receipt avatar.
- 02-10: the pin route gets `state.image.file`. Rerun `checkImage` on the server, because the browser check is only UX.
- 02-13: step 5 should focus its visible heading. The flow focuses `#step-heading`, so either give the live heading that id or add a branch. Revoke `state.image.url` on "Launch another".
- The links are stored normalized (`https://x.com/coin`) after a blur or Continue. Unblurred link text can still be raw, so steps 2 and 3 should read links through `normalizeLink` and not trust the raw fields.

## Requirements

None ticked. LAUNCH-01 is also covered by 02-18, and PLAT-04 by 02-18 and several other plans.

## Known Stubs

- Steps 2 to 5 render only their sr-only heading inside the panel. They arrive in 02-08 and 02-13, as planned.
- The receipt column is empty until 02-08.

## Threat Flags

None beyond the plan's threat model:
- T-02-07-01: links go through `normalizeLink`, so `javascript:` is refused with the website error copy (screenshot checked).
- T-02-07-02: the magic bytes of the first 12 bytes, the 4 MB cap and a decode are all checked, so SVG is refused (e2e).
- T-02-07-03: everything renders through React text, with no `dangerouslySetInnerHTML`.
- T-02-07-SC: exact pins, the publish dates above, and the CLI not run.

## Self-Check: PASSED

- All 10 created files are present, and btn.ts is deleted.
- Commits 1dbc5b3 and 4acb0b0 are on phase-02-launch-flow.
