# apps/web/e2e

Playwright specs (`*.e2e.ts`, run with `pnpm e2e`) and their helpers. `E2E_BASE_URL` points the run at a deployed app instead of the local worker and web servers.

- `phantom.ts`: the fake Phantom (`injectPhantom` with signTransaction and signMessage, a `reject` option for both and the signed `messages`; `emitChange`), consent helpers (`preConsent` stubs the browser's session read for specs whose launch routes are stubbed; `signIn` gets a real session through the API), test keys (`newTestAccount`, `simDevAccount`, `signWire`) and `rootEnv`, which reads the root .env without loading it into the runner.
- `coin.ts`: launch-form helpers (`toStep2`, `toStep3`, `liveStatus`, locators).
- `launch-stubs.ts`: page.route stubs for pin, prepare, submit and the launch read, plus `toSign` (steps 1-3, then Sign in Phantom).
- `launch-form.e2e.ts`: steps 1-3, validation and layout widths.
- `launch-live.e2e.ts`: steps 4 and 5. The stubbed group covers every failure state and the reload restore; the devnet group (`E2E_DEVNET=1`) runs one real minimum launch and checks the 5 s success window.
- `launch-recover.e2e.ts`: step 4 while a submit is still in the worker: a reload restores a prepared row, and a row prepared past its blockhash ends as expired, and a refused resend leaves the outcome to the row.
- `coin.e2e.ts`: the token page. The 404 group covers unknown, malformed, failed-only and prepared-only mints; the found group reads the newest landed devnet launch, plus a throwaway landed row with links (its fake mint has used_at set, so the pool never hands it out; both rows are deleted after).
- `wallet.e2e.ts`: connect, disconnect and account switching.
- `consent.e2e.ts`: the consent prompt and its server row: Accept signs once and a reload keeps the session, a rejected signature stores nothing, a bad signature is refused, the launch routes ignore a wallet in the body, and prepare refuses metadata the pin route did not build.
- `pin.e2e.ts`: the pin route's refusals.
- `terms.e2e.ts`: the terms page.
- `responsive.e2e.ts`: the UI-SPEC matrix, 12 surfaces at 390, 768 and 1440: no horizontal scroll, 0 axe violations, and a full-page screenshot each in `.planning/phases/02-launch-flow/screenshots/` (`-staging` suffix when `E2E_BASE_URL` is set). Steps 4 and 5 use the launch-live stubs. `E2E_COIN_MINT` sets the coin page's mint (staging); otherwise it is the newest landed launch on the dev branch.
- `paused.e2e.ts`: flips the real kill switch; runs alone after every other spec.
