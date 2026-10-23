---
phase: 01-chain-spike
plan: 01
subsystem: core
tags: [solana, pump, monorepo, walking-skeleton]
requires: []
provides:
  - "pnpm workspace with Biome (40-line function rule), tsc, vitest"
  - "packages/core/src/pump.ts: only SDK load point (pump-sdk 4.1.0, pump-swap-sdk 2.1.0)"
  - "packages/core/src/net.ts: connect(net) with genesis and host guard, redact()"
  - "packages/core/src/keys.ts: derive(master, role, net, id)"
  - "scripts/spike/keygen.ts: idempotent master seeds and public key print (pnpm spike:keys)"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09, 01-10]
tech-stack:
  added:
    - "@pump-fun/pump-sdk 4.1.0"
    - "@pump-fun/pump-swap-sdk 2.1.0"
    - "@solana/web3.js 1.99.0"
    - "@solana/spl-token 0.4.15"
    - "bn.js 5.2.5"
    - "vitest 4.1.11"
    - "@biomejs/biome 2.5.15"
    - "typescript 7.0.2"
    - "@types/node 24.19.1"
    - "@types/bn.js 5.2.0"
  patterns:
    - "createRequire SDK loading (Named export 'BN' crash workaround)"
    - "HMAC-SHA256 role:net:id domain-separated key derivation"
    - "RPC URL built in code, every outbound error passed through redact()"
key-files:
  created:
    - package.json
    - pnpm-workspace.yaml
    - pnpm-lock.yaml
    - biome.json
    - tsconfig.base.json
    - tsconfig.json
    - packages/core/package.json
    - packages/core/src/pump.ts
    - packages/core/src/net.ts
    - packages/core/src/net.test.ts
    - packages/core/src/keys.ts
    - packages/core/src/keys.test.ts
    - scripts/spike/keygen.ts
  modified:
    - .gitignore
    - .env.example
    - .planning/phases/01-chain-spike/01-VALIDATION.md
decisions:
  - "vitest pinned to 4.1.11, not 4.1.12: 4.1.12 was published 2026-10-15 (4 days old), so it fails the owner's 14-day rule too"
  - "@types/node 24.19.1 and packageManager pnpm@10.34.6 instead of 24.19.2 and 10.34.7 (14-day freshness rule)"
  - "Fork connect requires a local host AND mainnet genesis; devnet requires devnet genesis"
  - "TDD RED gate verified but not committed separately: AGENTS.md forbids red commits"
metrics:
  duration: "about 6 min"
  completed: 2026-10-19
  tasks: 3
  files: 16
---

# Phase 1 Plan 01: Workspace, SDK loader, network guard and keygen Summary

A pnpm workspace with Biome enforcing the 40-line function rule. `@bondr/core` loads pump-sdk 4.1.0 and pump-swap-sdk 2.1.0 through createRequire, derives keys with HMAC-SHA256 domain separation, and guards RPC by genesis hash and host. `pnpm spike:keys` is idempotent and prints the devnet payer to fund.

**Devnet payer to fund (plan 01-03):** `5d9ABCpNmjAaMBKF3EpPcMN61zogFDLFDDTxeaJpuDuk`

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | vitest legitimacy checkpoint | resolved by the owner before execution (no commit) |
| 2 | Workspace scaffold and SDK loader | 4024a36 |
| 3 | Network guard, key derivation, idempotent keygen | 4218887 |

## Printed keys (`pnpm spike:keys`, identical across runs)

```
devnet ops:main 5d9ABCpNmjAaMBKF3EpPcMN61zogFDLFDDTxeaJpuDuk
devnet treasury:main 4J9kCp2QvsGMid3YW2B11Ua6g58YHegt7TxAG4Yp6BDF
devnet sim:dev 9Hm1YEfXqR2WD78rLHBM6nhnEB9tTURcwxtpU9TjwQM6
devnet sim:trader 37MRDH4hHVAEDUfWHVSZjGn5PLPgeRKEXhSo1fpqVaVi
devnet sim:whale 4LpEeqRCYdi3yDtfCJGcm51tzprR4zabbrerA3ySWUfw
fork ops:main AvfWoWMfRooLWqBZGQvYqDKkSgjWtY8KzEjRDdeztgiB
fork treasury:main HSRgAnRH6651pLNW5VSh4tpVPTAk52zYf6v2xptQHHhg
fork sim:dev 7kNdRQrSUfjmJxjrXm6XaNRkTFfpNVPWhZkUbtAcPDKF
fork sim:trader eg53Cc9eiLkRFA23pLvyHnRa4e3T5BEp1iR6gNSnm96
fork sim:whale 3ngFuEREgkQJUNPyR9Ks3LBC445Jh6hMCX3JTegmmKPw
Fund this devnet payer: 5d9ABCpNmjAaMBKF3EpPcMN61zogFDLFDDTxeaJpuDuk
```

Seeds: `~/.bondr-spike/{devnet,fork}/master.seed`, dirs 0700, files 0600 (checked with stat).

## Verification

- `pnpm vitest run packages/core`: 5 tests pass (3 derive, 2 redact)
- `pnpm lint`, `pnpm typecheck`: exit 0. A throwaway 45-line function made lint fail with noExcessiveLinesPerFunction.
- `pnpm install --frozen-lockfile`: exit 0. `@pump-fun/pump-swap-sdk` resolves to 2.1.0 from packages/core.
- `import('@bondr/core/pump')` loads PUMP_SDK and OnlinePumpAmmSdk. All 14 planned export names exist at runtime in 4.1.0 and 2.1.0.
- No caret ranges in either package.json.
- Read-only guard smoke test (getGenesisHash only):
  - devnet connects.
  - A remote fork URL throws on the host check.
  - A local fork that is down throws "unreachable".
  - An empty key throws "helius_api_key missing in .env".
  - The Helius key appears 0 times in the output.

## Package freshness (cutoff 2026-10-05, 14 days before 2026-10-19)

| Package | Planned | Used | Planned version published | Note |
|---------|---------|------|---------------------------|------|
| vitest | 5.0.5, then the owner's 4.1.12 | 4.1.11 (2026-08-18) | 5.0.5: 2026-10-15T14:29Z, 4.1.12: 2026-10-15T14:51Z | 4.1.12 is a same-day backport ("mocker: harden manual and redirect mocks"). These tests use no mocks. The owner should confirm 4.1.11, or say to take 4.1.12 anyway |
| @types/node | 24.19.2 | 24.19.1 (2026-10-01) | 2026-10-09 | Same as agencybook |
| pnpm (packageManager) | 10.34.7 | 10.34.6 (2026-09-28) | 2026-10-12 | Same as agencybook |
| @pump-fun/pump-sdk | 4.1.0 | 4.1.0 | 2026-10-13 (6 days) | Exact pin kept on purpose (tracks pump's on-chain programs) |
| @pump-fun/pump-swap-sdk | 2.1.0 | 2.1.0 | 2026-10-07 (12 days) | Exact pin kept on purpose |
| @biomejs/biome 2.5.15, typescript 7.0.2, web3.js 1.99.0, spl-token 0.4.15, bn.js 5.2.5, @types/bn.js 5.2.0 | as planned | as planned | all on or before 2026-09-30 | Pass |

## Deviations from Plan

1. **[Owner pin override] vitest 4.1.11 instead of 4.1.12.** The orchestrator pinned 4.1.12 because 5.0.5 is only 4 days old. But 4.1.12 shipped 22 minutes after 5.0.5, so it fails the same 14-day rule. I used the newest 4.x that passes the rule. Changing to 4.1.12 is a one-line edit plus `pnpm install`. Files: package.json, pnpm-lock.yaml, 01-VALIDATION.md (framework row). Commit 4024a36.
2. **[Freshness rule]** Two more pins changed: @types/node went to 24.19.1 and packageManager to pnpm@10.34.6 (see the table). Commit 4024a36.
3. **Branch step skipped.** The orchestrator had already created and checked out phase-01-chain-spike, and I confirmed it was the current branch.
4. **[Rule 2] keygen opens the seed file with `flag: "wx"`**, and it rejects any seed that is not 32 bytes. This means a race can never overwrite a seed, and a truncated file can never derive keys silently. Commit 4218887.

## TDD Gate Compliance

RED was verified: both test files failed because the modules did not exist yet. RED was not committed as its own commit, because AGENTS.md section 2 forbids commits that leave the build red. Task 3 landed as one green commit (4218887). No `test(...)` commit exists for this plan.

## Known Stubs

None.

## Self-Check: PASSED

- All 13 created files are present, all under 300 lines (pnpm-lock.yaml is generated).
- Commits 4024a36 and 4218887 are on phase-01-chain-spike.
