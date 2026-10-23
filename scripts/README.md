# scripts

One-command devnet and fork tools. Each file's header comment lists its flags and the run command.

- `devnet-launch.ts`: the launch flow in-process with the sim dev (insta burn and insta sell), with ops floor and budgets.
- `devnet-checks.ts`: the landed-launch assertions devnet-launch prints.
- `devnet-trades.ts`: sim dev trades on a BONDR coin (multi-hop, curve, BONDR-only) and the `--complete` A8 gate.
- `stream-probe.ts`: `--listen` on the BONDR-mint logsSubscribe, `--check` a signature list against it and `getSignaturesForAddress`.
- `capture-tx.ts`: saves a tx as a fixture under `packages/core/src/fixtures/`.
- `check-client-bundle.sh`: fails if pump SDK, web3.js or spl-token code reached the web client bundle.
- `spike/`: the Phase 1 chain spike (its own README).
