# scripts

One-command tools. Each file's header comment lists its flags and the run command.

## Project entry points (OPS-04)

- `setup.sh` (`pnpm setup:local`): checks node 24 and pnpm, installs, creates `.env` from `.env.example` when missing, creates the local seed files with `spike:keys`, migrates when `.env` has `DATABASE_URL`.
- `dev.sh` (`pnpm dev:all`): worker and web together with `[worker]` and `[web]` log prefixes; Ctrl-C stops both.
- `test.sh` (`pnpm verify`, `pnpm verify --full`): the CI steps (lint, typecheck, Vitest, web build, `check:bundle`, `@smoke` against `next start` on port 3100); `--full` adds the whole Playwright run. `pnpm test` stays plain Vitest, which CI runs.
- `deploy.sh` (`pnpm run deploy -- <staging|production> [--yes] [--only web|worker] [--dry-run]`): `railway up` per service, web first when a migration changed since the local `deployed-<env>` tag (or it is missing), waits for SUCCESS, then moves the tag. Production needs a clean tree on `main` and the typed word `production` (or `--yes`). Always `--dry-run` first.
- `env-diff.ts` (`node scripts/env-diff.ts --from staging --to production --service web|worker [--phase g1|g3|g5]`): compares two Railway environments by variable name and SHA-256 only, never a value; exit 1 when a D-12 secret is shared, `ALLOW_MAINNET` is not `1`, or a gate's seed or quote mint rule fails.

## Devnet and fork tools

- `devnet-launch.ts`: the launch flow in-process with the sim dev (insta burn and insta sell), with ops floor and budgets.
- `devnet-checks.ts`: the landed-launch assertions devnet-launch prints.
- `devnet-trades.ts`: sim dev trades on a BONDR coin (multi-hop, curve, BONDR-only), the `--complete` A8 gate, and `--expect-indexed S` (exit 1 unless a running worker indexes each landed trade within S seconds).
- `stream-probe.ts`: `--listen` on the BONDR-mint logsSubscribe, `--check` a signature list against it and `getSignaturesForAddress`.
- `capture-tx.ts`: saves a tx as a fixture under `packages/core/src/fixtures/`.
- `contract-check.ts`: the pump contract check (OPS-02) against devnet or the fork, `--bondr <mint>` adds BONDR's curve or pool; exit 1 on any failed fact. Mainnet runs only in the production worker.
- `check-client-bundle.sh`: fails if pump SDK, web3.js or spl-token code reached the web client bundle.
- `spike/`: the Phase 1 chain spike (its own README).
