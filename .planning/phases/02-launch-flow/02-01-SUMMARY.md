---
phase: 02-launch-flow
plan: 01
subsystem: web-scaffold
tags: [nextjs, tailwind, biome, scaffold, env-allowlist]
requires: []
provides:
  - apps/web Next.js 16.3.8 app with the BONDR visual system (tokens.css, globals.css)
  - Header (skip link, brand, DEVNET badge, right-side slot) and Footer server components on every route
  - Biome D-15 noRestrictedImports allowlist for apps/web
  - WEB_ENV allowlist loader in apps/web/next.config.ts
  - Security headers (X-Frame-Options DENY, frame-ancestors 'none', Referrer-Policy, nosniff)
  - Root typecheck now includes the web typecheck (next typegen && tsc)
affects: [02-02, 02-05, 02-07, 02-14, every later web plan]
tech-stack:
  added: [next@16.3.8, react@19.3.0, react-dom@19.3.0, tailwindcss@4.3.3, "@tailwindcss/postcss@4.3.3", "@types/react@19.3.0", "@types/react-dom@19.3.0"]
  patterns:
    - "tokens.css owns every value; globals.css @theme inline maps Tailwind names onto it"
    - "Tailwind default palette cleared (--color-*: initial) so only BONDR colors exist as utilities"
    - "display and num type roles as @utility classes"
    - "Header children prop is the wallet slot"
key-files:
  created:
    - apps/web/package.json
    - apps/web/tsconfig.json
    - apps/web/next.config.ts
    - apps/web/postcss.config.mjs
    - apps/web/app/tokens.css
    - apps/web/app/globals.css
    - apps/web/app/layout.tsx
    - apps/web/components/chrome.tsx
  modified:
    - pnpm-workspace.yaml
    - package.json
    - pnpm-lock.yaml
    - biome.json
    - .gitignore
    - .planning/phases/02-launch-flow/02-VALIDATION.md
decisions:
  - "minimumReleaseAge stays 1440: 20160 (D-14) fails on locked rollup natives under @pump-fun/agent-payments-sdk; new pins checked by hand, all published on or before 2026-10-05"
  - "No fallback app/page.tsx: next build passes with only a root layout, and the 404 renders inside the chrome"
  - "Light leaks are not background-attachment fixed, matching the mockup (the @supports background shorthand would reset it anyway)"
metrics:
  duration: ~10 min
  completed: 2026-10-19
  tasks: 3
  files: 14
---

# Phase 2 Plan 01: Web scaffold, visual system and boundaries Summary

apps/web on Next 16.3.8 and Tailwind v4 with the BONDR tokens, a header and footer on every route, a Biome allowlist that fails closed on chain imports, and a root .env loader that passes only the WEB_ENV names to the web process.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Workspace, pinned web deps, Biome D-15 rule | cea1bf1 |
| 2 | Tokens, chrome, env allowlist, security headers | 717e57e |
| 3 | Measure quick-run latency | 67dcf4e |

## Verification

- `pnpm test` (27 passed), `pnpm lint`, `pnpm typecheck` (core tsc plus `next typegen && tsc -p .`) and `pnpm --filter @bondr/web build` all exit 0.
- Started app: `/no-such-page` returns 404 with the footer copy "BONDR adds no platform fee.", and the response carries all four security headers. No X-Powered-By.
- D-15 probe (temporary file, removed): `@solana/web3.js`, `bn.js`, `@bondr/core/launch` and `@pump-fun/pump-sdk` each fail lint; `@bondr/core/math` passes. The same imports under `apps/web/e2e/*.e2e.ts` pass.
- Env allowlist: importing next.config.ts with the real root .env adds only `pinata_jwt` to process.env; `helius_api_key`, `pinata_api_key` and `pinata_secret_api_key` stay out. No `loadEnvFile` anywhere in apps/web.
- With `SOLANA_NET=devnet` the header renders the DEVNET badge with the UI-SPEC title, and the footer program link gets `?cluster=devnet`.
- Visual check: a throwaway page (deleted, never committed) screenshotted at 1440 showed the light leaks, grain, Big Shoulders display, Martian Mono numbers, mint links, header and footer as the mockup.
- Quick run median 2.1 s (2.2, 2.1, 2.1), recorded in 02-VALIDATION.md; the latency sign-off box is ticked.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Root typecheck wiring moved from the Task 1 commit to the Task 2 commit**
- **Found during:** Task 1
- **Issue:** `next typegen` fails with "Couldn't find any pages or app directory" until the app directory exists, so wiring it in Task 1 would have made that commit's typecheck red.
- **Fix:** Task 1 left `typecheck` unchanged; Task 2 set it to `tsc -p tsconfig.json && pnpm --filter @bondr/web typecheck` together with the app directory.
- **Commits:** cea1bf1, 717e57e

**2. [Plan fallback] minimumReleaseAge kept at 1440**
- The plan anticipated this. With 20160, `pnpm add` failed: `@rollup/rollup-linux-x64-gnu@4.64.9` (40 h old), already locked under `@pump-fun/pump-sdk` -> `@pump-fun/agent-payments-sdk@1.0.7`. I reverted to 1440 and added a comment saying why. The publish dates of all 7 new pins were checked with `npm view`: next 2026-09-30, react, react-dom and both @types 2026-09-09, tailwindcss and @tailwindcss/postcss 2026-07-16. All are on or before the 2026-10-05 cutoff, so nothing was substituted.

**3. [Rule 2 - Correctness] Reduced-motion `!important` suppressed with a reason**
- Biome's `noImportantStyles` warned on the reduced-motion override. The `!important` is required so the user's motion preference beats every utility, so it is wrapped in a `biome-ignore-start/end` range that gives the reason.

## Notes for later plans

- Next's built-in 404 injects `body{background:#fff}` (light color scheme), so unknown URLs show the BONDR chrome around a white body until a plan adds `app/not-found.tsx`. 02-15, the coin 404, is the natural place for it.
- `next build` warns "Failed to find font override values for font Big Shoulders". This is harmless: next/font has no metrics for it, and the CSS stack falls back to Arial Narrow. `adjustFontFallback: false` does not silence the warning, so it was not kept.
- Type-role utilities `display` and `num` are in globals.css. Tailwind `rounded-sm`, `rounded-md` and `rounded-lg` resolve to 8, 12 and 20 px, and `ease-out` is the BONDR curve. Use the spring with `ease-(--ease-spring)`.
- Only BONDR colors exist as utilities, because the Tailwind palette is cleared, so `bg-red-500` and similar classes generate nothing.

## Known Stubs

- `Header` right-side slot is empty until 02-05 passes the wallet control as `children`. This is intentional and in the plan.
- The footer's `/terms` link returns 404 until 02-02 builds the page. This is intentional and in the plan.

## Self-Check: PASSED

- All 8 created files and 6 modified files are present.
- Commits cea1bf1, 717e57e and 67dcf4e are on phase-02-launch-flow.
