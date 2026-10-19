---
phase: 02-launch-flow
plan: 05
subsystem: web-wallet-consent
tags: [phantom, wallet-standard, consent, e2e]
requires: [02-01, 02-02, 02-04]
provides:
  - "WalletProvider and useWallet (apps/web/components/wallet.tsx): status loading/idle/connecting/connected/missing, address, consented, connect, disconnect, signTransaction(bytes), onAccountChange, markConsented"
  - "Exported helpers: isPhantom(wallet, chain), rejected(error) for the 02-13 sign step"
  - "WalletButton in the header on every page: Connect Phantom, Opening Phantom…, short address with a Copy address / Disconnect popover menu, the Phantom-not-installed popover with the mobile deep link"
  - "ConsentDialog: native dialog, bottom sheet below 768px, opens on the first connect of an address with no stored consent"
  - "POST /api/consent: same-origin, JSON-only, 16 KB cap, base58 check, upserts wallets(address, consented_at, terms_version)"
  - "apps/web/lib/guard.ts sameOrigin(req) and json(req, maxBytes), for later POST routes"
  - "apps/web/lib/db.ts (server-only re-export of @bondr/core/db) and lib/terms.ts TERMS_VERSION"
  - "apps/web/components/btn.ts: btn(variant, size) class strings until 02-07 ports the shadcn Button"
  - "e2e fixture apps/web/e2e/phantom.ts: injectPhantom, emitChange, newTestAccount, preConsent, rootEnv"
affects: [02-07, 02-08, 02-13, 02-14, 02-18]
tech-stack:
  added:
    - "@wallet-standard/app@1.1.1 (and @wallet-standard/base@1.1.1)"
    - "lucide-react@1.52.0"
    - "server-only@0.0.1"
    - "drizzle-orm@0.45.3 (declared in web)"
    - "postgres@3.4.9 (dev, web)"
    - "bs58@6.0.0 (dev, web)"
  patterns:
    - "Consent is derived during render from localStorage, so the dialog never flashes for an address that already consented"
    - "The dialog mounts per address (key) and opens in an effect; unmount closes it and returns focus to #wallet-button"
    - "Popovers use the native popover attribute and CSS anchor positioning (anchor-name --wallet, position-area bottom span-left)"
    - "The wallet control is aria-disabled while loading (hydration plus the 600 ms grace), so Playwright waits for it instead of clicking a dead button"
key-files:
  created:
    - apps/web/components/wallet.tsx
    - apps/web/components/wallet-button.tsx
    - apps/web/components/consent-dialog.tsx
    - apps/web/components/btn.ts
    - apps/web/app/api/consent/route.ts
    - apps/web/lib/db.ts
    - apps/web/lib/guard.ts
    - apps/web/lib/terms.ts
    - apps/web/e2e/phantom.ts
    - apps/web/e2e/wallet.e2e.ts
    - apps/web/e2e/consent.e2e.ts
  modified:
    - apps/web/package.json
    - pnpm-lock.yaml
    - apps/web/components/chrome.tsx
    - apps/web/app/layout.tsx
    - apps/web/app/globals.css
    - apps/web/app/terms/page.tsx
    - apps/web/next.config.ts
decisions:
  - "Header renders WalletButton itself; the children slot from 02-01 is gone"
  - "A fifth wallet status, loading, covers hydration and the grace period"
  - "Every connect error returns quietly to Disconnected; non-rejection errors are logged by error name only"
  - "Consent upsert errors log only the SQLSTATE and return 503, because drizzle error messages carry the address as a query param"
  - "The bottom sheet uses its own sheet keyframe with ease-out; a spring overshoot would lift it off the bottom edge. From 768px it uses rise with the spring"
  - "Button styles live in btn.ts class strings until 02-07 ports the shadcn Button"
metrics:
  duration: ~25 min of work, plus a 7 min idle wait for the Neon cold-start run
  completed: 2026-10-19
  tasks: 2
  files: 18
---

# Phase 2 Plan 05: Phantom connect and consent Summary

The header on every page now connects Phantom through Wallet Standard. It shows the short address with a Copy address / Disconnect menu, and offers the not-installed popover (with the Phantom browse deep link on phones) when there is no Phantom. On the first connect of an address, a native consent dialog opens. Nothing carries the address until Accept, which upserts one `wallets` row through a same-origin, JSON-only route. Declining by button, Escape or the backdrop disconnects and stores nothing.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Fake Phantom, wallet e2e, provider and header control | c4ffd60 |
| 2 | Consent dialog, consent API with guard and upsert, consent e2e | 103800b |

Each task's spec was written first and failed before the code existed: 6 of 6 wallet tests, then 6 of 6 consent tests. As instructed, no red step was committed. Each test was committed together with its code.

## Verification

- `pnpm exec playwright test apps/web/e2e` with a warm database: all passed. That was 18 tests before the Save failed spec was added, and 19 after (wallet 6, consent 7, terms 6).
- Cold-start run after the Neon compute had been idle for 7 minutes, past the 5-minute suspend: 19 passed in 16.0 s, with no CONNECT_TIMEOUT.
- `pnpm test` (30 passed), `pnpm lint`, `pnpm typecheck` and `pnpm --filter @bondr/web build` all exit 0. The build lists `ƒ /api/consent`.
- Acceptance greps: no `signAndSendTransaction` and no `@solana` import in apps/web outside e2e. `solana:signTransaction` is in wallet.tsx, `phantom.com/ul/browse` in wallet-button.tsx, `showModal` in consent-dialog.tsx, `bondr:consent:` in components/wallet.tsx, `TERMS_VERSION` in both terms/page.tsx and the route, and there is no `console.log` or `console.info` in app/api.
- After the runs, the dev branch has 0 `wallets` rows. Each consent spec deletes its own random addresses in afterAll.
- Screenshots of the consent dialog at 1440, 768 and 390, and of the not-installed popover at 1440 and 390, match consent.html: centered card at 120px from the top, bottom sheet on the phone. They are not committed, and designer sign-off is at 02-18.

E2E coverage:
- wallet: short address on a forest button, menu copy and disconnect, account switch via the standard:events change, not-installed popover on desktop, deep link on an iPhone UA, and 44px tap targets at 390.
- consent: no request carries the address before Accept, Accept stores one row and returns focus to the wallet button, and reconnecting does not reprompt. Not now, Escape and the backdrop each store nothing. Save failed shows the alert and re-enables the buttons. The terms link opens in a new tab. The API returns 403 cross-site and 400 for non-base58, over 16 KB and text/plain.

## Assumptions resolved

- **A4 confirmed:** @wallet-standard/app 1.1.1 `lib/esm/wallets.js` listens for `wallet-standard:register-wallet`, whose `detail` is a callback it calls with `{ register }`, and dispatches `wallet-standard:app-ready`, whose `detail` is `{ register }`. The fake Phantom uses both.
- **A1 still unverified with a real Phantom:** the provider follows `standard:events` change and also listens to `window.phantom.solana` `accountChanged` as a fallback. Both handlers re-read `wallet.accounts`. Check this on real Phantom at the 02-18 sign-off.
- **A7 (mobile in-app browser registration)** is untouched here. Check it on a phone at 02-18.

## Freshness (14-day cutoff 2026-10-05)

| Package | Published |
|---------|-----------|
| @wallet-standard/app 1.1.1 | 2026-06-03 |
| @wallet-standard/base 1.1.1 (transitive) | 2026-06-03 |
| lucide-react 1.52.0 | 2026-10-04 |
| drizzle-orm 0.45.3 | 2026-09-21 |
| postgres 3.4.9 | 2026-04-05 |
| server-only 0.0.1 | 2022-09-03 |
| bs58 6.0.0 | 2024-06-24 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] next dev blocked its own scripts on 127.0.0.1**
- **Found during:** Task 1, first green run
- **Issue:** Next 16 dev refuses cross-origin access to `/_next/*` dev resources from 127.0.0.1, which is the Playwright baseURL. The page never hydrated, so the static terms e2e passed but every interactive spec failed.
- **Fix:** `allowedDevOrigins: ["127.0.0.1"]` in apps/web/next.config.ts. It is a dev-only setting.
- **Commit:** c4ffd60

**2. [Rule 1 - Bug] Popover display class overrode the closed state**
- **Found during:** Task 1
- **Issue:** `grid` on the `popover` element beat the UA `display: none`, so the closed not-installed panel covered the button.
- **Fix:** `open:grid`.
- **Commit:** c4ffd60

**3. [Rule 1 - Bug] Neon cold start outlasted the web client's connect_timeout**
- **Found during:** Task 2, the first full e2e run
- **Issue:** The first Accept after the compute had suspended got `CONNECT_TIMEOUT` from postgres.js, whose `connect_timeout` is 10 s in core db.ts. The route returned 503 and the dialog correctly showed Save failed. A user can retry, but the spec failed.
- **Fix:** consent.e2e.ts wakes the compute in `beforeAll` with its own client, using postgres.js's default 30 s connect timeout. Core db.ts is unchanged.
- **Commit:** 103800b

**4. [Rule 2 - Privacy] Upsert errors log no address**
- Drizzle's error message includes the query params, so Next's default error log would have written the wallet address to stderr. The route catches the error, logs only the SQLSTATE or error code, and returns 503.
- **Commit:** 103800b

### Additions

- A `loading` wallet status. `btn.ts` class strings. A `sheet` keyframe in globals.css. `preConsent` in the fixture, so wallet-only specs skip the dialog. An extra e2e for the mobile deep link and one for Save failed.
- `lib/guard.ts` has no unit test. Its behaviour (403, three 400 cases, same-origin 204) is covered by consent.e2e.ts.

## Notes for later plans

- Gate quote, pin and prepare on `useWallet().consented`, not only on `status === "connected"`.
- `signTransaction(bytes)` throws when Phantom is not connected. Use `rejected(e)` to tell a user cancel from a real failure.
- `onAccountChange(cb)` fires only on a switch between two connected accounts. 02-13 uses it to cancel step 4.
- The wallet control's id is `wallet-button`, and `focusButton()` from wallet-button.tsx returns focus to it.
- 02-07: replace `btn()` with the ported Button, and extend the wallet e2e to /launch.
- The consent prompt sends the Phase 2 promise "Error reports ... without wallet data". 02-14 must keep the Sentry scrub.

## Requirements

None ticked. PLAT-01, PLAT-02 and PLAT-04 are all also listed by 02-18, the sign-off plan, and PLAT-04 by several more.

## Known Stubs

- The fake Phantom's `solana:signTransaction` throws "not wired (02-13)", as planned.
- The consent copy is the D-07 draft, pending owner review at 02-18.

## Threat Flags

None beyond the plan's threat model. T-02-05-01 to T-02-05-04 are mitigated and covered by e2e. T-02-05-05 is accepted.

## Self-Check: PASSED

- All 11 created files are present.
- Commits c4ffd60 and 103800b are on phase-02-launch-flow.
