---
phase: 01-chain-spike
plan: 04
subsystem: spike
tags: [surfpool, fork, mainnet-fork, launch]
requires: [01-03]
provides:
  - "scripts/spike/fork.sh: up (download Surfpool 1.6.1 once, start, poll getSlot, log key scan) and down"
  - "pnpm spike:fork-up / spike:fork-down"
  - "scripts/spike/nets/fork.ts: [configStage, createStage, launchStage]"
  - "scripts/spike/fund.ts: fundFork (100 SOL airdrops with the from-remote retry), aux.prefund.<mint> rows"
  - "scripts/spike/results/fork.json: fork evidence rows"
affects: [01-05, 01-06, 01-07, 01-08, 01-09, 01-10]
tech-stack:
  added: []
  patterns:
    - "The upstream RPC key reaches Surfpool only through the SURFPOOL_DATASOURCE_RPC_URL env var; the log scan pipes the key on stdin"
    - "A hand-set SURFPOOL_DATASOURCE_RPC_URL overrides the Helius default, which is the public RPC fallback"
key-files:
  created:
    - scripts/spike/fork.sh
    - scripts/spike/nets/fork.ts
    - scripts/spike/results/fork.json
  modified:
    - package.json
    - scripts/spike/README.md
    - scripts/spike/fund.ts
    - scripts/spike/stages/create.ts
decisions:
  - "Live mainnet pump config on the fork matches the PROJECT.md fee assumptions with no drift (max creator fee 300 bps, curve 95 protocol, AMM exotic 20 LP / 5 protocol)"
  - "fork.sh keeps a hand-set SURFPOOL_DATASOURCE_RPC_URL, so the public RPC fallback is one env var, with no script edit"
metrics:
  duration: "about 6 min"
  completed: 2026-10-19
  tasks: 2
  files: 8
---

# Phase 1 Plan 04: Surfpool mainnet fork create and launches Summary

One command now starts a Surfpool 1.6.1 mainnet fork, and the Helius key never appears in any argv. On the fork, a child create_v2 landed with creator = W, quote = stand-in Q and creator_fee_bps 150, and the decoded curve reads back 150, so SPIKE-01 is proven exactly as written. Both one-tx launches also landed there, burn and sell to SOL, with the dev holding 0 child tokens afterwards. That repeats SPIKE-02 against the live mainnet programs.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Surfpool fork up/down script and fork config stage | 23e3450 |
| 2 | Fork create with 150 bps and fork launches (burn, sell to SOL) | 4de2b7b |

## Fork

- Surfpool 1.6.1 darwin-arm64 was downloaded to `.cache/surfpool/` (gitignored), with Helius mainnet as the upstream.
- It forked from mainnet slot 458,726,767 ("Datasource connection successful. Epoch 1061"). getSlot answered 458,726,800.
- A second `pnpm spike:fork-up` prints "fork already up" and exits 0.
- Key exposure checks:
  - `ps` shows the surfpool argv without the key: the "surfpool start" + "api-key" count is 0. The check was run from a file, because the shell's own command line matched itself.
  - The node `ps -axww` argv check exits 0.
  - The log scan found no key in `.cache/surfpool/`.
  - `api-key` appears 0 times in fork.json.
- The fork was stopped with `pnpm spike:fork-down`.

## Live mainnet config on the fork (row "config")

- creatorFeeConfigurable true, maxConfigurableCreatorFeeBps 300, maxCurveDepth 2, createV2Enabled true, globalBytes 1088
- initialVirtualSolReserves 30 SOL, initialVirtualTokenReserves 1,073,000,000,000,000, initialRealTokenReserves 793,100,000,000,000, tokenTotalSupply 1,000,000,000,000,000
- Curve flat 95 / 30, curve exotic 95 / 30 (the curve's own 150 bps replaces the creator part)
- AMM flat 25 LP / 5 protocol / 0 creator. AMM exotic 20 / 5 / 5. AMM tier 0 2 / 93 / 30.
- buybackFeeRecipient0 5YxQFdt3..., withdrawAuthority 39azUYFW...
- **Drift: none.** The fork matches PROJECT.md.

## Fork evidence (results/fork.json)

| Row | Signature | Bytes | CU |
|-----|-----------|-------|----|
| standin.create (Q 621k7ZQP..., creator = treasury HSRgAnRH...) | 4DnRcqTjJc84... | 928 | 98,303 / 300,000 |
| child.create (C0 ChjgqLsd..., creator = W eF9JbArn..., quote = Q, depth 1, creatorFeeBps 150) | 3BZcSa2nouP6... | 1,064 | 140,360 / 300,000 |
| launch.table.burn (26 keys, 2 txs) | 2MgR4pgDRf1C... | 1,072 max | 29,739 |
| launch.burn | 4b7H1fg4L5zc... | 780 | 309,238 / 600,000 |
| launch.table.sell (31 keys, 2 txs) | 4UCSwwr34jTS... | 1,072 max | 31,182 |
| launch.sell (multi_hop child to Q to SOL) | vpSjo2WRbp97... | 881 | 442,775 / 600,000 |
| aux.prefund x4 (Q, C0, C.burn, C.sell; 5,000,000 lamports each) | - | 217 | 150 |

W was re-derived independently with `derive(fork master, "w", "fork", C0)`. It equals the on-chain curve creator eF9JbArn...

### Launch sizes and CU

| Exit | No table | Shared-only table | Per-coin table (landed) | CU |
|------|----------|-------------------|-------------------------|----|
| burn | 1,552 | 1,059 | 780 | 309,238 |
| sell to SOL | 1,808 | 1,191 | 881 | 442,775 |

- solIn was 250,000,000 lamports, the PROJECT.md minimum.
- Burn: amount 31,310,323,469,601. The supply went from 1,000,000,000,000,000 to 968,689,676,530,399, so it dropped by exactly the amount. devChildAfter "0".
- Sell: amount 31,129,019,829,766, devChildAfter "0", and the supply is unchanged. The sellq fallback did not run.
- The sell used 442,775 CU on the fork against 420,959 on devnet. That leaves 157k CU of headroom.

## Verification

- `SPIKE_NET=fork pnpm spike` gives "fork: 11 ok, 0 failed".
- `SPIKE_NET=fork pnpm spike:check` gives 12 passed, 0 failed, including the secret scan.
- `pnpm spike:page` gives "PASS 19, FAIL 0, EXPECTED FAIL 1, NOT RUN 0" across devnet and fork.
- `pnpm lint` and `pnpm typecheck` exit 0.
- There is no `child.create150.refused` row in fork.json.
- `git diff --name-only HEAD -- packages/core` is empty. packages/core was not touched.
- `rg 'grep .*helius_api_key' scripts/spike/fork.sh` finds nothing.
- `git check-ignore .cache/surfpool/out.log` matches.
- No devnet SOL was spent: the fork net only, with airdropped SOL.

## Deviations from Plan

1. **[Rule 2] fork.sh fails fast on a missing key.** It uses `${helius_api_key:?missing in .env}` and skips the log scan when the key is empty. Without that guard, an empty pattern would make `grep -f -` match every file. Commit 23e3450.
2. **The README fallback is an env override.** fork.sh keeps a hand-set `SURFPOOL_DATASOURCE_RPC_URL`, so the documented fallback is `SURFPOOL_DATASOURCE_RPC_URL=https://api.mainnet-beta.solana.com pnpm spike:fork-up`. Commit 23e3450.
3. **fundFork is a separate helper.** It is in fund.ts and is called at the start of the create stage (a no-op on devnet). `fundSol` keeps its top-up meaning, and fork airdrops go through the new retry. Commit 4de2b7b.

The fork revealed no bugs in create.ts, launch.ts or core.

## Known Stubs

None.

## Notes for later plans

- Every fork run starts from a fresh results file, and the stand-in curves differ on each run.
- The Surfpool `out.log` logs every account it fetches. It stays in `.cache/surfpool/`.

## Requirements

SPIKE-01 (150 bps, creator = W, pump-coin quote, on the fork) and SPIKE-02 (one-tx create, dev buy and insta exit, on the fork) are complete.

## Self-Check: PASSED

- fork.sh, nets/fork.ts and results/fork.json are present.
- Commits 23e3450 and 4de2b7b are on phase-01-chain-spike.
