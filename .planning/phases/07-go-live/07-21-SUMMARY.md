---
phase: 07-go-live
plan: 21
subsystem: spike (Surfpool mainnet fork rehearsal)
tags: [fork, surfpool, rehearsal, genesis, sender-tip, contract-check]
requires: [07-08, 07-09, 07-16, 07-17]
provides:
  - "scripts/spike/stages/genesis.ts genesisStage: rows genesis.create, genesis.tip, genesis.launch.table.burn, genesis.child, genesis.contract, genesis.verify, genesis.verify-neg (+ aux.genesis.fund)"
  - "fork evidence (scripts/spike/results/fork.json) that the worker's genesis pipeline lands on a mainnet fork"
  - "apps/worker/src/prepare.ts exports finalMessage (tip, compile, simulate) so the rehearsal skips only the DB insert"
  - "scripts/spike/stages/launch.ts launchOne(run, exit, prefix, id?) takes an optional row id"
affects: [07-28 genesis launch on mainnet (G-1 pre-gate item 1)]
key-files:
  created:
    - scripts/spike/stages/genesis.ts
  modified:
    - scripts/spike/nets/fork.ts
    - scripts/spike/stages/README.md
    - scripts/spike/stages/launch.ts
    - apps/worker/src/prepare.ts
    - scripts/spike/results/fork.json
    - scripts/spike/results/index.html
    - packages/core/src/fixtures/pool-sell-launch.json
key-decisions:
  - "07-21: the rehearsal's finish dep calls the worker's own finalMessage (now exported) instead of a copy, so only the insert is skipped (T-07-21-01)"
  - "07-21: the genesis stage runs last on the fork net, so a crash there never hides other rows"
requirements-completed: []  # OPS-05 needs the mainnet genesis; LAUNCH-08 needs the live Sender relay; OPS-02 closes with 07-28/07-36
duration: 30min
completed: 2026-10-26
---

# Phase 7 Plan 21: Fork Genesis Rehearsal Summary

**The genesis launch works on the Surfpool mainnet fork, first try. The worker's own `genesisOne` built it on a mainnet-configured ctx. `simulateLaunch` and `cosign` (with the same inputs as submit's cosignRow) both accepted it, and the dev-signed transaction landed. It is a SOL pair, the creator is an external in-memory treasury, and the dev buy was burned in the same 757-byte transaction, which carries the Sender tip. A child launch quoted in the new mint also landed. `contract-check --net fork --bondr <mint>` passes with the mainnet profile. `verifyQuoteMint` accepts the genesis mint and refuses the child mint.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | The genesis stage on the fork | 403f839 |
| 2 | Run the fork rehearsal and the contract check, record the evidence | 34b4fb7 |

## Evidence (fresh fork, full fork net: 109 ok, 0 failed; `pnpm spike:check` exit 0)

| Row | Result |
|-----|--------|
| genesis.create | Landed. The facts below. |
| genesis.tip | `tipped()` is true. The tip account wyvPkW... is a static key and not in the table. 757 bytes. |
| genesis.launch.table.burn + genesis.child | The child launched on the genesis mint's curve. The dev was left holding 0 child tokens, and the supply dropped by exactly the amount bought. 780 bytes. |
| genesis.contract | `checkContract(conn, "fork", genesisMint)` returned facts [] |
| genesis.verify | Resolves |
| genesis.verify-neg | Rejects with "BONDR_QUOTE_MINT is not a SOL-pair coin" |

genesis.create facts:
- 757 bytes, 175,657 CU against a 600k limit.
- creator = treasury, and quoteMint = the system id (SOL).
- devAfter is 0. The supply dropped by exactly tokensOut (8,609,300,761,901).
- The simulated spend was 254,736,922 lamports.
- cosign was accepted.
- The mint is a fresh keypair, because the fork has no vanity pool.

- CLI: `node --env-file=.env scripts/contract-check.ts --net fork --bondr <genesis mint>` exits 0 with facts [] and slots pump 458921440 / pump AMM 458921517 / pump fees 456132171.
- Plan verify command exits 0. tsc and `pnpm lint` are green. cosign.test.ts still passes on the rewritten pool-sell-launch fixture.
- First full fork run: the genesis prefund hit the known Surfpool "Failed to fetch accounts from remote" upstream blip. The rerun on a fresh fork was all green.

## Deviations from Plan

1. **[Rule 3 - Blocking] `key("dev", "genesis")` does not exist**, because Role has no "dev". The dev is `ctx.key("sim", "genesis")` instead.
2. **[Rule 2 - Fidelity] `finalMessage` is exported from apps/worker/src/prepare.ts.** This is one keyword plus a comment, with no behavior change. The injected `finish` runs the worker's real tip, compile and simulate steps and skips only `insertPrepared`, instead of copying them into the spike (T-07-21-01). The plan said "no worker code changes for the rehearsal". This touches no behavior.
3. **The `table` dep is also injected.** It is the worker's `ensureTable` with the fork ops key and no prior lookup, which avoids the `tableFor` DB read.
4. **The plan's "no Postgres" does not fully hold.** `genesisOne` calls `liveStatus(ctx, true)`, which reads the settings row once through `loadSwitches`. Avoiding it would need a worker change. The stage calls `close()` at the end so the process exits.
5. **launchOne takes an optional row id**, so the child launch records as `genesis.child`. Its table row is `genesis.launch.table.burn`.

No product bug was found. The genesis create+buy+burn and its co-sign worked on the first on-chain run.

## Known Stubs

None.

## Self-Check: PASSED

- scripts/spike/stages/genesis.ts exists (about 250 lines).
- Commits 403f839 and 34b4fb7 are in the log.
