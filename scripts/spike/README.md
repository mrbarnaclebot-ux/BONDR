# scripts/spike

The phase 1 chain spike: run pump steps on devnet and on a local Surfpool mainnet fork, record each result as evidence, check it, and render it.

## What lives here

- `keygen.ts`: creates the master seeds once and prints public keys.
- `results.ts`: the shared contract (Row, ResultsFile, Rule, Ctx, Stage) plus the load, save and record helpers.
- `run.ts`: runs each net's stage list in order and saves a row after every step.
- `nets/<net>.ts`: the ordered stage list for that net. Adding a step means adding one stage file and one line here.
- `stages/*.ts`: one stage per file. Each stage has `run(ctx)` and `rules(net)`, and its rules are keyed by row id.
- `check.ts`: the strict gate. It fails on a missing row, a row that is not ok, a rule failure, or a leaked RPC key.
- `page.ts`: writes `results/index.html`.
- `results/<net>.json`: committed evidence. It holds public chain data only.

## Commands

| Command | Does |
|---------|------|
| `pnpm spike:keys` | Creates the seeds if missing (idempotent) and prints the public keys and the devnet payer to fund |
| `pnpm spike` | Runs the stages and writes `results/<net>.json`. Exits 1 if any row failed, but only after saving |
| `pnpm spike:check` | Checks every rule against the results. Prints one PASS or FAIL line per id and exits 1 on any failure |
| `pnpm spike:page` | Writes `results/index.html` |

The page is written whatever the check says. Failed rows show their error code and text. Steps that never ran show as NOT RUN, and expected failures show as EXPECTED FAIL.

## Environment

- `SPIKE_NET`: `devnet`, `fork` or `all`. The default is `all`, which runs devnet and then the fork.
- `SPIKE_ONLY=<stage>`: runs only that stage.
- `SPIKE_FRESH=1`: reruns devnet stages whose rows are already ok. Devnet SOL is scarce, so those stages are skipped by default.
- `SPIKE_KEYS_DIR`: the seed directory. The default is `~/.bondr-spike`, and seeds live at `<dir>/<net>/master.seed`, outside the repo.
- `SPIKE_FORK_URL`: the fork RPC. The default is `http://127.0.0.1:18899`, and only local hosts are accepted.
- `helius_api_key` in the repo-root `.env`: used for devnet RPC.

The RPC URL is built in code and never printed. Every error and every results file passes through `redact()`, and `spike:check` fails if the key or `api-key=` shows up in a results file.

Fork results reset at the start of each fork run, because each run builds a fresh stand-in. Devnet results accumulate across runs.
