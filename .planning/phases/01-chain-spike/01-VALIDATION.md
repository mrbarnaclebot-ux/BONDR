---
phase: 1
slug: chain-spike
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 1 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Status words are plain text (no emoji, per AGENTS.md).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 5.0.5 for pure math and keys; `scripts/spike/check.ts` asserts the chain evidence in the results JSON |
| **Config file** | none. Wave 0 may add `vitest.config.ts`; the defaults are fine |
| **Quick run command** | `pnpm vitest run packages/core` |
| **Full suite command** | `pnpm vitest run && pnpm spike:check` |
| **Estimated runtime** | Vitest about 5 s; spike:check about 2 s; a full devnet spike run takes minutes (1 send/s on Helius free tier) |

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run` plus `pnpm biome ci .`
- **After every plan wave:** the affected network's `pnpm spike`, then `pnpm spike:check`
- **Before `/gsd:verify-work`:** `SPIKE_NET=all pnpm spike && pnpm spike:check && pnpm spike:page`, all green
- **Max feedback latency:** 10 seconds for unit checks

---

## Per-Task Verification Map

The planner fills task IDs. Requirement-level contract from 01-RESEARCH.md, Validation Architecture:

| Requirement | Behavior asserted | Test Type | Automated Command | File Exists | Status |
|-------------|-------------------|-----------|-------------------|-------------|--------|
| SPIKE-01 | Create rows ok with signature. Decoded curve: creator == W, quoteMint == stand-in, depth == 1, creatorFeeBps == 150 on fork | chain evidence | `pnpm spike:check` | Wave 0 | pending |
| SPIKE-02 | Burn and sell launch rows on both networks: ok, bytes <= 1232, cu <= limit, dev child balance 0; burn supply drop == amount; per-coin lookup table created and used | chain evidence | `pnpm spike:check` | Wave 0 | pending |
| SPIKE-03 | Forced-bond row: curve complete after tx, CompleteEvent decoded, W child balance 0. Pool buy + burn: supply drop == baseOut. Migrate rows ok | chain evidence | `pnpm spike:check` | Wave 0 | pending |
| SPIKE-04 | Update row ok; SharingConfig shares [8000, 2000], admin revoked; second update fails with a pump-fees error code; distribute deltas 80:20 within 1 unit, both > 0 | chain evidence | `pnpm spike:check` | Wave 0 | pending |
| SPIKE-05 | multi_hop buy and sell rows ok, outAmount >= minAmountOut > 0; 6107 row err == 6107 | chain evidence | `pnpm spike:check` | Wave 0 | pending |
| math | split90_10 sums exactly; trigger105; costToComplete matches SDK quote; exact-out amounts never exceed minimum | unit | `pnpm vitest run packages/core/src/math.test.ts` | Wave 0 | pending |
| keys | Derivation deterministic; role, network and id each change the key | unit | `pnpm vitest run packages/core/src/keys.test.ts` | Wave 0 | pending |
| config | Results record live Global/FeeConfig per network and flag drift from PROJECT.md fee assumptions | chain evidence | `pnpm spike:check` | Wave 0 | pending |

---

## Wave 0 Requirements

- [ ] Root `package.json`, `pnpm-workspace.yaml`, `biome.json`, `tsconfig.base.json`; `.gitignore` adds `.cache/` and `.surfpool/`
- [ ] `packages/core/src/math.test.ts`, `packages/core/src/keys.test.ts`
- [ ] `scripts/spike/check.ts` with a results row type shared with `run.ts`
- [ ] Spike key generation script: writes `~/.bondr-spike/<net>/*.json` (mode 0600), prints public keys only

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Devnet spike wallet funded | SPIKE-01..05 (devnet rows) | Public airdrop is failing; owner uses a web faucet (D-15) | Run key generation, copy the printed devnet payer public key, fund about 1.5 SOL at faucet.solana.com, confirm with `solana balance <pubkey> --url devnet` |
| Results page reads well | SPIKE-05 success criterion 5 | Visual check by the owner | `pnpm spike:page`, open the generated HTML, confirm every row shows its environment, signature, bytes and CU |

---

## Validation Sign-Off

- [ ] All tasks have an automated verify step or a Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without an automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency under 10 s for unit checks
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
