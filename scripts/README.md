# scripts

One-command tools. Each file's header comment lists its flags and the run command.

## Project entry points (OPS-04)

- `setup.sh` (`pnpm setup:local`): checks node 24 and pnpm, installs, creates `.env` from `.env.example` when missing, creates the local seed files with `spike:keys`, migrates when `.env` has `DATABASE_URL`.
- `dev.sh` (`pnpm dev:all`): worker and web together with `[worker]` and `[web]` log prefixes; Ctrl-C stops both.
- `test.sh` (`pnpm verify`, `pnpm verify --full`): the CI steps (lint, typecheck, Vitest, web build, `check:bundle`, `@smoke` against `next start` on port 3100); `--full` adds the whole Playwright run. `pnpm test` stays plain Vitest, which CI runs.
- `deploy.sh` (`pnpm run deploy -- <staging|production> [--yes] [--only web|worker] [--dry-run]`): `railway up` per service, pinned to the Railway project bondr (the checkout must be linked to it), web first when a migration changed since the local `deployed-<env>` tag (or it is missing; `--only worker` is then refused), waits for SUCCESS, then tags the commit it checked at the start. Production needs a clean tree on `main` at exactly `origin/main`, a green CI run for that commit, and the typed word `production` (or `--yes`). Always `--dry-run` first: every guard runs before it exits.
- `env-diff.ts` (`node scripts/env-diff.ts --from staging --to production --service web|worker [--phase g1|g2|g3|g5]`): checks production's variables against staging and the go-live policy by name and fact only (railway's output goes straight into jq; no value reaches node or the terminal, the seed is read for presence only); exit 1 when a required name is missing, a D-12 secret equals staging, a public value is not exact (`SOLANA_NET=mainnet`, `SITE_URL`, `VANITY_LANE`, `ALLOW_MAINNET=1`), any value has surrounding whitespace, or a gate's treasury, seed or quote mint rule fails. Pinned to the Railway project bondr.

## Devnet and fork tools

- `devnet-launch.ts`: the launch flow in-process with the sim dev (insta burn and insta sell), with ops floor and budgets.
- `devnet-checks.ts`: the landed-launch assertions devnet-launch prints.
- `devnet-trades.ts`: sim dev trades on a BONDR coin (multi-hop, curve, BONDR-only), the `--complete` A8 gate, and `--expect-indexed S` (exit 1 unless a running worker indexes each landed trade within S seconds).
- `stream-probe.ts`: `--listen` on the BONDR-mint logsSubscribe, `--check` a signature list against it and `getSignaturesForAddress`.
- `capture-tx.ts`: saves a tx as a fixture under `packages/core/src/fixtures/`.
- `contract-check.ts`: the pump contract check (OPS-02) against devnet or the fork, `--bondr <mint>` adds BONDR's curve or pool; exit 1 on any failed fact. Mainnet runs only in the production worker.
- `check-client-bundle.sh`: fails if pump SDK, web3.js or spl-token code reached the web client bundle.
- `spike/`: the Phase 1 chain spike (its own README).
