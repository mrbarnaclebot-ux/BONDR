---
phase: 01-chain-spike
verified: 2026-10-19T00:00:00Z
status: passed
score: 5/5 success criteria verified
overrides_applied: 0
gaps: []
warnings:
  - "01-VALIDATION.md still reads status: draft, wave_0_complete: false, every map row pending, Approval: pending"
  - "Owner sign-off is recorded second-hand (relayed through the coordinator), not as an owner-authored artifact"
  - "Fork signatures cannot be re-verified on chain: the Surfpool fork is ephemeral, so fork evidence is the committed JSON plus the check rules"
---

# Phase 1: Chain Spike Verification Report

**Phase goal:** As the owner, I want every pump step proven on a mainnet fork (revised to hybrid: devnet where possible, Surfpool fork for the gaps, D-01), so that I build on facts, not docs.
**Verified:** 2026-10-19
**Status:** passed
**Re-verification:** No, initial verification

## Commands run

| Command | Result |
| --- | --- |
| `SPIKE_NET=all pnpm spike:check` | 74 passed, 0 failed (23 devnet incl. secret-scan, 51 fork incl. secret-scan) |
| `pnpm vitest run` | 6 files, 25 tests passed |
| `pnpm lint` (biome ci) | 45 files, clean |
| `pnpm typecheck` | clean |
| Public devnet `getSignatureStatuses` on 8 devnet signatures (read-only) | 8 finalized; 7 ok, 1 err = `sharing.update2.rejected`, which is the expected failure |

## Per-criterion table

| # | Criterion | Evidence rows (net, sig prefix, facts) | Rule that asserts it | Status |
| --- | --- | --- | --- | --- |
| 1 | create_v2 with creator = W, stand-in quote, creator_fee_bps 150 | fork `child.create` sig 2zuzPpaE3d, facts creator == W, quoteMint == Q, depth 1, creatorFeeBps "150". Stand-in `standin.create` 4E54kNtLNX. Devnet `child.create` 1UsFdo1hgN (default fee) and `child.create150.refused` code 6077 (why the fork is needed) | `childRule` checks sig, creator == W, quoteMint == state.Q, depth 1, and 150 on fork. `refusedRule` pins code 6077 plus the name | VERIFIED |
| 2 | create + dev buy + insta sell, and separately insta burn, one tx, bytes and CU under limits | fork `launch.burn` 26yTv3fhzv 780 B / 316738 CU, `launch.sell` 3hDFdqnpYF 881 B / 448775 CU; devnet `launch.burn` 2cYEyQd2Ja 780 B, `launch.sell` 43Bndc1Gm3 881 B. Each has a per-coin lookup table row. No-table size recorded (1552 / 1808 B, over 1232), so the table is shown to be required | `launchRule`: sig, bytes <= 1232, cu <= cuLimit, devChildAfter == "0", size facts present, and for burn supply drop == amount bought | VERIFIED |
| 3a | Forced-bond buy_exact_quote_in_v3 + burn completes a curve in one tx | fork `bond.forced` 5UViydNBmx 926 B / 127506 CU: complete true, completeEvents 1, wChildAfter "0", burnAmount == supply drop 804811320754713, trigger105 true on `bond.topup`. `bond.exact` (buy_v3 variant) also lands | `bondRule`: sig, bytes, cu, complete, wChildAfter 0, CompleteEvent >= 1, supply drop == burn amount, trigger105 | VERIFIED |
| 3b | Post-migration PumpSwap buy + burn | fork `bond.migrate` eo7WYexRGo (pool exists), `bond.pool.burn` 7KEMqi7LyJ 915 B: wChildAfter "0", supply drop 6067640892546 == baseOut | `migrateRule` (pool account exists), `burnRule` (bytes, W holds 0, burn == baseOut) | VERIFIED |
| 4 | create_fee_sharing_config + one update_fee_shares_v2 at deployer 8000 / treasury 2000, second update rejected, distribution pays both | fork `finalize.config` 3DVDWjsWZ9, `finalize.update` 2KkrWvPQgV shares "8000,2000", holders deployer,treasury, adminRevoked true; `finalize.distribute` 2HdGVu6C8U deltas 138264336404 / 34566084101 (exactly 80:20); `finalize.update2.rejected` UXHk3rRffw code 6009 sharingConfigAdminRevoked, matches devnet code 6009. Devnet also has config/update 67XyaXMAK8 and rejected 3yp5BinX23 | `updateRule` (shares, holders, admin revoked from decoded SharingConfig), `distributeRule` (both > 0, treasury within 1 unit of 20%), `rejectedRule` (landed failure, 6000..6999, logged name equals pump-fees IDL name) | VERIFIED |
| 5 | Bare page lists every step with signature, incl. multi_hop_swap buy and sell | `index.html` (0 script tags, 74 table rows, header "PASS 67, FAIL 0, EXPECTED FAIL 5, NOT RUN 0", Devnet and Surfpool sections). Multihop: devnet `multihop.buy` kb1irdzojF / `multihop.sell` 2Rgsjcb8B4 (curve route); fork `migrated.multihop.buy` WuMb7dXBMo / `.sell` 5UWk3nh1nE (pool route). PROJECT.md carries 24 cited evidence references and Validated (Phase 1) rows | `legRule`: sig, outAmount from landed meta, minAmountOut > 0, out >= min. `page.ts` shows FAIL and NOT RUN rather than hiding them | VERIFIED |

Requirement coverage:

| Requirement | Satisfied by | Status |
| --- | --- | --- |
| SPIKE-01 | Criterion 1 | SATISFIED |
| SPIKE-02 | Criterion 2 | SATISFIED |
| SPIKE-03 | Criterion 3a and 3b | SATISFIED |
| SPIKE-04 | Criterion 4 | SATISFIED |
| SPIKE-05 | Criterion 5 (buy and sell, curve route on devnet, pool route on fork) | SATISFIED |

No orphaned requirements: REQUIREMENTS.md maps only SPIKE-01..05 to Phase 1, all claimed by plans.

## Check rules vs claims

The rules in `scripts/spike/nets/*.ts` and `scripts/spike/stages/*.ts` assert on-chain facts read after landing (decoded curve, decoded SharingConfig, token balances, supply deltas, CompleteEvent count), not just ok and a signature. Every rule id needs an ok row; any recorded row not covered by a rule must also be ok. A missing sig fails each rule. The secret scan fails on the Helius key or any `api-key=` text.

Weaknesses noted, none blocking:
- The `cu <= cuLimit` assertion is near-tautological (the cuLimit is the tx's own compute-budget limit). The "under the limits" claim is really carried by bytes <= 1232 plus a successful landing.
- `bond.exact` leaves 7.37T Q in W (`wQAfter`). The owner decision (2026-10-19) makes that variant evidence only, and the forced path (`wQAfter` "0") is the shipped one.
- The "single update" on bonded C2 is split across a config tx and an update tx with a pool sweep (oneTxBytes 1351 > 1232). This is recorded in the row facts and is a finding for Phase 5, not a gap.

## Behavioral and compliance checks

| Check | Result |
| --- | --- |
| Helius key (36 chars, from `.env`) in worktree or any commit across `git rev-list --all` | 0 hits. Not printed. |
| Results files, planning docs | 0 hits for the key; `api-key=` appears only in plan and research prose as a placeholder or redaction example |
| `.env` | git-ignored, not tracked |
| Seeds | at `~/.bondr-spike/{devnet,fork}/master.seed`, outside the repo; no seed or keypair files tracked |
| Emoji across tracked files | none |
| Files over 300 lines | only data and lockfiles: `fixtures/*.json`, `results/*.json`, `pnpm-lock.yaml`. All `.ts` and `.sh` under 300 (largest `stages/prebond.ts` at 298) |
| Biome 40-line function limit | enforced in `pnpm lint`, passes |
| Working tree | clean before the report was written |

## Owner sign-off

Recorded in `01-10-SUMMARY.md` (Task 3 "approved 2026-10-19") and in commits bd38925 (two decisions written into PROJECT.md: full-budget forced-bond burn, treasury tops up ops), dc71893 and ff16160 (Phase 1 marked complete). ROADMAP.md and REQUIREMENTS.md mark Phase 1 and SPIKE-01..05 complete. PROJECT.md was updated per the rule that failed or changed steps force a PROJECT.md change.

## Warnings (not blockers)

1. `01-VALIDATION.md` was never closed out: frontmatter `status: draft`, `wave_0_complete: false`, all map rows "pending", Approval "pending". The evidence it points to exists and passes, so this is bookkeeping only. Suggest updating it before Phase 2.
2. The owner sign-off is relayed ("reached this executor through the coordinator"). The git history records it, but there is no owner-authored line. The project owner is the human in this session, so I treat it as accepted, but flag it as the one claim I cannot independently verify.
3. Fork evidence is not re-verifiable on chain (ephemeral fork). Devnet evidence is: 8 sampled devnet signatures are finalized with the expected ok or err outcome. The fork rows are internally consistent (signatures, facts, supply arithmetic) and `matchesDevnet` ties the rejection code to the devnet one.
4. Devnet and fork use different stand-in coins for several rows (documented in row notes; `aux.devnet.refresh` says sharing and 6107 devnet rows ran against the old Q). Transparent, not misleading.

## Human verification

None required beyond the sign-off already recorded. The page visual check was part of the approved 01-10 Task 3.

## Gaps Summary

No gaps. All five success criteria and SPIKE-01..05 are backed by passing, non-trivial evidence rows. The phase goal (facts, not docs, for every pump step) is achieved. Phase 2 may start.

_Verified: 2026-10-19_
_Verifier: Claude (gsd-verifier)_
