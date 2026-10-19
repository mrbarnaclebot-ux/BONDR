# scripts/spike

The phase 1 chain spike: run pump steps on devnet and on a local Surfpool mainnet fork, record each result as evidence, check it, and render it.

## What lives here

- `keygen.ts`: creates the master seeds once and prints public keys.
- `results.ts`: the shared contract (Row, ResultsFile, Rule, Ctx, Stage) plus the load, save and record helpers.
- `run.ts`: runs each net's stage list in order and saves a row after every step.
- `nets/<net>.ts`: the ordered stage list for that net. Adding a step means adding one stage file and one line here.
- `stages/*.ts`: one stage per file. Each stage has `run(ctx)` and `rules(net)`, and its rules are keyed by row id.
- `fork.sh`: starts and stops the local Surfpool mainnet fork (see Fork below).
- `check.ts`: the strict gate. It fails on a missing row, a row that is not ok, a rule failure, or a leaked RPC key.
- `page.ts`: writes `results/index.html`.
- `all.sh`: the one-command gate behind `pnpm spike:all` (see below).
- `results/<net>.json`: committed evidence. It holds public chain data only.

## Commands

| Command | Does |
|---------|------|
| `pnpm spike:all` | The phase gate in one command (`all.sh`): starts the fork if needed, runs devnet then the fork, writes the page, runs the check, then prints `spike:all run=<n> check=<n>` and exits 1 if either is non-zero |
| `pnpm spike:keys` | Creates the seeds if missing (idempotent) and prints the public keys and the devnet payer to fund |
| `pnpm spike` | Runs the stages and writes `results/<net>.json`. Exits 1 if any row failed, but only after saving |
| `pnpm spike:check` | Checks every rule against the results. Prints one PASS or FAIL line per id and exits 1 on any failure |
| `pnpm spike:page` | Writes `results/index.html` |
| `pnpm spike:fork-up` | Starts the Surfpool 1.6.1 mainnet fork on 127.0.0.1:18899 (idempotent; downloads the binary once) |
| `pnpm spike:fork-down` | Stops the fork |

The page is written whatever the check says. Failed rows show their error code and text. Steps that never ran show as NOT RUN, and expected failures show as EXPECTED FAIL.

## spike:all

- `all.sh` runs every step even when one fails (no `set -e`). If the fork does not start it prints "fork did not start" and carries on; the run records row `fork.error`, so the page shows it.
- The page `results/index.html` is committed with both JSON files, including runs with failing rows: a failure is evidence too.
- Expected runtime is about 45 s from a stopped fork: devnet stages whose rows already pass skip, and the fork rebuilds everything.
- Fork signature links point the explorer at 127.0.0.1:18899, so they only open while the fork runs. Devnet links always open.
- Reading the page:
  - PASS: the row landed and its rule holds.
  - FAIL: the row failed (error code and text shown), or it landed but its rule failed (reason shown).
  - EXPECTED FAIL: the program refused as the spec predicts, with the code shown (150 bps on devnet, the second fee-share update, 6107).
  - NOT RUN: a required step has no row, usually because an earlier stage crashed.
  - TOP-UP: in Notes marks a balance top-up the spike made, not part of the mechanic.

## Environment

- `SPIKE_NET`: `devnet`, `fork` or `all`. The default is `all`, which runs devnet and then the fork.
- `SPIKE_ONLY=<stage>`: runs only that stage.
- `SPIKE_FRESH=1`: reruns devnet stages whose rows are already ok. Devnet SOL is scarce, so those stages are skipped by default.
- `SPIKE_KEYS_DIR`: the seed directory. The default is `~/.bondr-spike`, and seeds live at `<dir>/<net>/master.seed`, outside the repo.
- `SPIKE_FORK_URL`: the fork RPC. The default is `http://127.0.0.1:18899`, and only local hosts are accepted.
- `helius_api_key` in the repo-root `.env`: used for devnet RPC.

The RPC URL is built in code and never printed. Every error and every results file passes through `redact()`, and `spike:check` fails if the key or `api-key=` shows up in a results file.

Fork results reset at the start of each fork run, because each run builds a fresh stand-in. Devnet results accumulate across runs.

## Fork

`fork.sh` runs Surfpool from `.cache/surfpool/` (gitignored): the binary, `out.log`, `logs/` and `pid` all live there. RPC is on port 18899 and websocket on 18900. Run `SPIKE_NET=fork pnpm spike` once it is up.

The upstream is Helius mainnet, handed over only through the `SURFPOOL_DATASOURCE_RPC_URL` env var, never `--rpc-url`, so the key never shows in `ps`. If Helius rate-limits the fork warm-up (Pitfall 8), stop the fork and start it with the public RPC instead: `SURFPOOL_DATASOURCE_RPC_URL=https://api.mainnet-beta.solana.com pnpm spike:fork-up`.
