# apps/web/e2e

Playwright specs (`*.e2e.ts`, run with `pnpm e2e`) and their helpers. `E2E_BASE_URL` points the run at a deployed app instead of the local worker and web servers.

- `phantom.ts`: the fake Phantom (`injectPhantom`, `emitChange`, `preConsent`), test keys (`newTestAccount`, `simDevAccount`, `signWire`) and `rootEnv`, which reads the root .env without loading it into the runner.
- `coin.ts`: launch-form helpers (`toStep2`, `toStep3`, `liveStatus`, locators).
- `launch-stubs.ts`: page.route stubs for pin, prepare, submit and the launch read, plus `toSign` (steps 1-3, then Sign in Phantom).
- `launch-form.e2e.ts`: steps 1-3, validation and layout widths.
- `launch-live.e2e.ts`: steps 4 and 5. The stubbed group covers every failure state and the reload restore; the devnet group (`E2E_DEVNET=1`) runs one real minimum launch and checks the 5 s success window.
- `coin.e2e.ts`: the token page. The 404 group covers unknown, malformed, failed-only and prepared-only mints; the found group reads the newest landed devnet launch, plus a throwaway landed row with links (its fake mint has used_at set, so the pool never hands it out; both rows are deleted after).
- `wallet.e2e.ts`: connect, disconnect and account switching.
- `consent.e2e.ts`: the consent prompt and its server row.
- `pin.e2e.ts`: the pin route's refusals.
- `terms.e2e.ts`: the terms page.
- `paused.e2e.ts`: flips the real kill switch; runs alone after every other spec.
