---
phase: 1
slug: chain-spike
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-19
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Status words are plain text (no emoji, per AGENTS.md).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.5 for pure math, keys, send and events; `scripts/spike/check.ts` asserts the chain evidence in the results JSON; Biome enforces format, lint and the 40-line function limit |
| **Config file** | none for Vitest (defaults); `biome.json` (01-01) |
| **Quick run command** | `pnpm vitest run packages/core` |
| **Full suite command** | `pnpm vitest run && pnpm spike:check` |
| **Estimated runtime** | Vitest about 5 s; spike:check about 2 s; a full devnet spike run takes minutes (1 send/s on Helius free tier) |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run` plus `pnpm lint` and `pnpm typecheck`. Stage tasks that do not end a plan stop here.
- **Once per plan:** the last chain task runs the affected network's full `pnpm spike` once, then `pnpm spike:check` (devnet: passed stages skip, so only the new stage spends SOL).
- **Before `/gsd:verify-work`:** `pnpm spike:all` (01-10). It always writes the page, then exits with the run and check status. Exit 0 is the gate; a non-zero exit needs an approved PROJECT.md change per failed row.
- **Max feedback latency:** 10 seconds for unit checks.

---

## Per-Task Verification Map

| Requirement | Behavior asserted | Test Type | Automated Command | Plan-Task | Status |
|-------------|-------------------|-----------|-------------------|-----------|--------|
| SPIKE-01 | Create rows ok with signature. Decoded curve: creator == W, quoteMint == stand-in, depth == 1, creatorFeeBps == 150 on fork; devnet 150 refusal recorded | chain evidence | `pnpm spike:check` | 01-03-T2 (devnet), 01-04-T2 (fork), 01-09-T2 (migrated quote) | pending |
| SPIKE-02 | Burn and sell launch rows on both networks: ok, bytes <= 1232, cu <= limit, dev child balance 0; burn supply drop == amount; per-coin lookup table created and used; no-table and shared-only sizes recorded | chain evidence | `pnpm spike:check` | 01-03-T3 (devnet), 01-04-T2 (fork), 01-10-T1 (devnet refresh) | pending |
| SPIKE-03 | Collect + 90/10 split exact; forced-bond row: curve complete, CompleteEvent decoded, W child balance 0, supply drop == burn; buy_v3 exact variant; migrate ok; pool buy + burn supply drop == baseOut | chain evidence | `pnpm spike:check` | 01-06-T2, 01-07-T3 (bond and pool rows; 01-07-T2 wires the stage) | pending |
| SPIKE-04 | Update row ok; SharingConfig shares [8000, 2000], admin revoked; second update fails with a pump-fees code; distribute deltas 80:20 within 1 unit, both > 0 | chain evidence | `pnpm spike:check` | 01-05-T2 (devnet unbonded), 01-08-T2 (fork bonded) | pending |
| SPIKE-05 | multi_hop buy and sell rows ok, outAmount >= minAmountOut > 0 (curve route devnet, pool route fork); 6107 row code == 6107 | chain evidence | `pnpm spike:check` | 01-05-T1, 01-05-T3, 01-09-T2, 01-10-T1 (devnet refresh) | pending |
| math | applyBps, split90_10 sums exactly, trigger105. costToComplete is the SDK quote (not hand-rolled), proven on chain by the forced bond completing with a 106% budget | unit + chain evidence | `pnpm vitest run packages/core/src/math.test.ts` | 01-03-T2, 01-03-T3, 01-06-T1, 01-07-T1 | pending |
| keys | Derivation deterministic; role, network and id each change the key; keygen re-run prints identical keys | unit + command | `pnpm vitest run packages/core/src/keys.test.ts` | 01-01-T3 | pending |
| net | redact removes the key value and api-key query values | unit | `pnpm vitest run packages/core/src/net.test.ts` | 01-01-T3 | pending |
| send | checkMessage allowlist refuses unknown programs; wireSize estimates oversized messages | unit | `pnpm vitest run packages/core/src/send.test.ts` | 01-03-T2 | pending |
| events | innerEvents on a ported agencybook launch fixture; CompleteEvent decoded from the captured fork forced-bond tx | unit | `pnpm vitest run packages/core/src/events.test.ts` | 01-07-T1, 01-07-T3 | pending |
| config | Results record live Global/FeeConfig per network and flag drift from PROJECT.md fee assumptions | chain evidence | `pnpm spike:check` | 01-02-T1, 01-04-T1 | pending |
| page | Page written whatever the check says; failed rows show FAIL with code, missing required rows NOT RUN | command | `pnpm spike:page` | 01-02-T2, 01-10-T1 | pending |
| secrets | Results files and page never contain the Helius key; no process argv carries it while the fork runs | chain evidence + command | `pnpm spike:check` | 01-02-T2, 01-04-T1, 01-10-T1 | pending |
| size | No function over 40 lines (Biome noExcessiveLinesPerFunction) | lint | `pnpm lint` | every task from 01-01-T2 on | pending |

---

## Wave 0 Requirements

Each check file is listed with the plan task that creates it.

- [ ] Root `package.json`, `pnpm-workspace.yaml`, `biome.json` (with the 40-line rule), `tsconfig.base.json`, `tsconfig.json`; `.gitignore` adds `.cache/` and `.surfpool/` (01-01-T2)
- [ ] `packages/core/src/keys.test.ts`, `packages/core/src/net.test.ts`, and the idempotent `scripts/spike/keygen.ts`, which writes `~/.bondr-spike/<net>/master.seed` (mode 0600) and prints public keys only (01-01-T3)
- [ ] `scripts/spike/results.ts` (row type shared by run, check and page) and `scripts/spike/run.ts` (01-02-T1); `scripts/spike/check.ts` and `scripts/spike/page.ts` (01-02-T2)
- [ ] `packages/core/src/math.test.ts` and `packages/core/src/send.test.ts` (01-03-T2)
- [ ] `packages/core/src/events.test.ts` with the ported fixture `packages/core/src/fixtures/launch-20261008.json` (01-07-T1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| vitest legitimacy | package gate | slopcheck [SUS] false positive needs a human (01-01-T1) | Open npmjs.com/package/vitest and confirm the vitest-dev repository and version 5.0.5 |
| Devnet spike wallet funded | SPIKE-01..05 (devnet rows) | Public airdrop is failing; owner uses a web faucet (D-15, 01-03-T1) | Run `pnpm spike:keys`, copy the printed devnet payer public key, fund about 1.5 SOL at faucet.solana.com, confirm with `solana balance <pubkey> --url devnet` |
| Results page and PROJECT.md changes | SPIKE-05 success criterion 5 | Visual check and spec approval by the owner (01-10-T3) | Open scripts/spike/results/index.html and confirm every row shows its environment, signature, bytes and CU; review the PROJECT.md diff |

---

## Validation Sign-Off

- [x] All tasks have an automated verify step or a Wave 0 dependency (the checkpoint tasks are listed under manual-only)
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency under 10 s for unit checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
