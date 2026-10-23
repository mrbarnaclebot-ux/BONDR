---
phase: 02-launch-flow
verified: 2026-10-23T04:05:00Z
status: passed
score: 6/6 success criteria verified (criterion 3 closed by the owner's real Phantom launch, 2026-10-23)
verified_commit: d3cec5e63b9a69300d25e098c4934dff0d6488cf
overrides_applied: 0
deferred:
  - truth: "worker-core review WR-08: forcedBondIxs sets minOut to W's whole child balance, so a leftover in W reverts every later forced bond"
    addressed_in: "Phase 5"
    evidence: "Phase 5 SC2: 'When W's burn budget reaches 105% of the cost to complete the curve, one buy + burn transaction lands ... and the coin bonds'. The code is not called by any Phase 2 path; tracked in STATE.md Pending Todos."
human_verification:
  - test: "Owner launches one coin on https://web-staging-72bad.up.railway.app with the real Phantom extension (Testnet Mode, devnet-funded account), minimum dev buy, either exit"
    expected: "Phantom signs without rewriting the message, the worker co-signs (no 'cosign_refused'), the tx lands; the summary records the launch signature and any Phantom warning text, as 02-18 Task 3 acceptance requires"
    why_human: "Every recorded launch (02-12 scripts, 02-13 e2e, the 02-17 staging launch 5VFhiFFR...fM8E) was signed by the Playwright fake Phantom (apps/web/e2e/phantom.ts). Real-extension byte stability (T-02-18-02) and account-change events (A1) are only verifiable with the real extension. The 02-18 approval was given without the signature or warning text."
  - test: "Owner picks the IPFS gateway for on-chain metadata and coin images (recommended: Pinata dedicated gateway via PINATA_GATEWAY), or explicitly accepts ipfs.io for devnet with a must-fix-before-mainnet note"
    expected: "New launches write a metadata URI and image URI that resolve (HTTP 200) for wallets, explorers and the coin page; or a recorded owner override"
    why_human: "Owner decision and an outward-facing redeploy. Verified 2026-10-23: the landed mint's on-chain URI https://ipfs.io/ipfs/bafkreicx7i... and its image CID both answer 429 on ipfs.io and 200 on gateway.pinata.cloud. The mint's updateAuthority is null, so each URI written now is permanent."
---

# Phase 2: Launch Flow Verification Report

**Phase Goal:** As a dev, I want to launch a coin in one Phantom signature, so that buyers see I hold zero launch supply.
**Mode:** mvp
**Verified:** 2026-10-23 (against committed HEAD d3cec5e)
**Status:** human_needed
**Re-verification:** No, initial verification

## User Flow Coverage

| Step of the story | Expected | Evidence in codebase / staging | Status |
| --- | --- | --- | --- |
| Dev connects Phantom and consents | Phantom only; consent signed before any wallet row | `components/wallet.tsx` `isPhantom` filter (D-08); `api/consent/route.ts` verifies a Phantom `signMessage` over an HMAC nonce before the `wallets` upsert | VERIFIED |
| Dev fills the form and dev buy | Launch gated on live minimum and exit | `launch-buy.tsx` `checkBuy`/`disabled={!state.exit \|\| !!error}`; worker re-checks with `parseRequest` + `checkDevBuy`; staging `/api/status` minLamports 2500000 (0.0025 SOL) | VERIFIED |
| Dev signs one transaction | One tx: create `bndr` mint (creator = W), buy, sell or burn; server co-sign only on exact bytes with exit | `core/cosign.ts` byte compare + slot-0 sig + `exitPresent`; `prepare.ts:178` creator `derive(seed,"w",net,mint)`; staging tx 5VFhiFFR...fM8E finalized, err null; mint CyR56...Pbndr | VERIFIED with fake Phantom; real Phantom UNCERTAIN |
| Outcome: buyers see dev holds 0 | Success screen and token page show the proof | Staging `/coin/CyR56...Pbndr` 200, renders "Dev holds 0 launch supply", the CA, the Solscan devnet tx link, "On curve" | VERIFIED |

The `[outcome]` clause is observably true on staging. The open question is whether the "one Phantom signature" half holds with the real extension. No recorded launch used it.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Connect/disconnect Phantom (only wallet) from any page; consent prompt linking to terms before BONDR stores anything | VERIFIED | `app/layout.tsx` mounts `Header`, `Footer`, `ConsentDialog` inside `WalletProvider` on every route. `wallet.tsx:52` accepts only `name === "Phantom"`. `wallet-button.tsx:74` Disconnect. `api/consent/route.ts` refuses without a verified signature (`verifyConsent`), then upserts `wallets` and sets the session. Pin, prepare and submit read the wallet only from that session (`launch/prepare/route.ts`). The consent dialog links `/terms` (`consent-dialog.tsx:137`), and so does the footer (`chrome.tsx:75`). Staging `/terms` returns 200. |
| 2 | Name, symbol, image, description, optional links; launch disabled until dev buy >= live minimum and exit chosen | VERIFIED | `core/rules.ts` (name 32 bytes, symbol 13, links normalized to https, magic-byte image check). `launch-buy.tsx:109` disables Continue until there is an exit and no error. `checkBuy` refuses below `minLamports`. The worker re-checks every field and the minimum (`prepare.ts:80-98, 145`). `core/math.ts` holds the minimum as reserves/120 (0.25 SOL mainnet, 0.0025 SOL devnet). Staging `/api/status` reports minLamports 2,500,000. |
| 3 | One Phantom tx creates a `bndr` mint with creator = W, metadata and image pinned on Pinata, buys then sells or burns; tampered or exit-less message gets no co-sign | UNCERTAIN (WARNING) | **Code, VERIFIED:** `cosign()` raw-byte compare, dev sig at slot 0, exit from the stored row checked in the stored message, mint slot re-checked after signing. Six refusal unit tests pass (`cosign.test.ts`). The 02-12 devnet `--tamper` run was refused `message_mismatch` with nothing sent. Creator = W comes from `derive(seed,"w",net,mint)` in the worker only. **Chain, VERIFIED (public devnet RPC read):** signature finalized, err null, slot 513986869. The mint ends in `bndr`, is Token-2022, and has a null update authority. **Pinning, VERIFIED:** the metadata and image CIDs return 200 on gateway.pinata.cloud. **Open:** (a) every recorded launch was signed by the Playwright fake Phantom, and the owner's real-Phantom launch was not recorded (02-18 acceptance unmet). (b) The on-chain URI host is ipfs.io, which returns 429 for both the metadata and the image. |
| 4 | Success screen within 5 s of confirmation with "Dev holds 0 launch supply", exit tx link, full CA with copy, button to token page | VERIFIED | `launch-live.tsx` renders `ProofStamp` ("Dev holds 0 launch supply" plus a Solscan tx link), `CaRow` ("Copy address") and `Link href=/coin/{mint}` "Open {SYMBOL}". It shows when the row reads landed and waits for no indexer. Staging: 2,399 ms after blockTime (02-17). The staging coin page renders the proof, the CA and the tx link (fetched 2026-10-23). |
| 5 | Paused banner with Launch disabled (form stays fillable) on kill switch or BONDR awaiting migration; launch pages work at mobile/tablet/desktop | VERIFIED | `status.ts:44 pauseReason` returns kill_switch or awaiting_migration. `launch-flow.tsx:183` shows the warn callout with copy for both. `launch-review.tsx:106` shows the disabled "Launches paused" button, and the form steps are not gated by the pause. `paused.e2e.ts`. Responsive: 36 `*-staging.png` committed. The staging matrix passed 37/37 on deployed build fc083332: 0 axe violations, no horizontal scroll at 390/768/1440, header fits at 320. |
| 6 | Errors in web and worker show up in Sentry | VERIFIED | `instrumentation.ts`, `instrumentation-client.ts` and `worker/src/sentry.ts` init with the shared `scrub` and `dataCollection`. `main.ts` imports Sentry first. The 02-16 staging test events were bondr-web 6ca0649b... and bondr-worker e859bd21..., and the owner's approval covers the check. Not re-verified in the Sentry UI by this verifier. |

**Score:** 5/6 verified, 1 uncertain, 0 failed.

### 02-18 plan truths

| Truth | Status | Evidence |
| --- | --- | --- |
| Staging runs the Designer-fixed build, deployed after owner approval | VERIFIED | Worker 4a0f6b31 and web fc083332 from ef8cf3b. The approval is quoted in 02-18-SUMMARY. `/api/health` returned `{"ok":true}` (2026-10-23). |
| Staging responsive and axe pass green on the redeployed build | VERIFIED | 37/37 recorded. 36 staging PNGs present. |
| Owner reviewed copy, launched once with real Phantom on staging, signed off | UNCERTAIN | Copy reviewed and "approved" is recorded. The real-Phantom launch signature and the warning text are absent, which the plan's acceptance criterion requires. |

### Deferred Items

| # | Item | Addressed In | Evidence |
| --- | --- | --- | --- |
| 1 | worker-core WR-08 (forced-bond minOut uses W's whole balance) | Phase 5 | Phase 5 SC2 (forced bond buy + burn). No Phase 2 path calls `forcedBondIxs`. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `apps/web/components/wallet.tsx`, `wallet-button.tsx` | Phantom-only connect/disconnect | VERIFIED | Wired in layout through `WalletProvider` and `Header` |
| `apps/web/app/api/consent/route.ts`, `lib/session.ts` | Signed consent, session | VERIFIED | Signature verified before any write |
| `apps/web/app/terms/page.tsx` | Short terms | VERIFIED | Contact handle is a placeholder (Info, see below) |
| `apps/web/components/launch-*.tsx` | 5-step flow | VERIFIED | Registered in `launch-flow.tsx` BODIES |
| `packages/core/src/cosign.ts` | Co-sign gate | VERIFIED | Unit-tested, devnet tamper refused |
| `apps/worker/src/prepare.ts`, `submit.ts`, `settle.ts`, `vanity.ts` | Build, co-sign, settle, bndr pool | VERIFIED | Staging launch landed |
| `apps/web/lib/pinata.ts` | Pin before signing | VERIFIED (WARNING) | Pins to Pinata, but `const IPFS = "https://ipfs.io/ipfs/"` writes an unreachable gateway into the on-chain URI. `core/rules.ts` `URI_PREFIX` hard-enforces ipfs.io in the worker. |
| `apps/web/app/coin/[mint]/page.tsx` | Bare token page | VERIFIED | Staging 200 with the proof. The image is blank (ipfs.io 429). |
| `apps/web/e2e/responsive.e2e.ts` + screenshots | Responsive/axe matrix | VERIFIED | 36 staging + 36 local PNGs |
| `scripts/check-client-bundle.sh`, `next.config.ts` WEB_ENV | FEE-10 isolation | VERIFIED | No `*_SEED` or master seed name in the web allowlist. `forbiddenEnv` boot guard. Bundle marker gate. |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| consent dialog | `wallets` row + session | `signMessage` -> POST /api/consent -> `verifyConsent` -> upsert | WIRED |
| launch routes | wallet identity | `sessionWallet(req)`, never the body | WIRED |
| pin route | prepare route | HMAC `proof` over (uri, imageCid), checked by `pinnedHere` | WIRED |
| web prepare/submit | worker | `workerPost` bearer, passes 410/422 | WIRED |
| worker prepare | W creator | `derive(seed,"w",net,mint)` -> `buildLaunch` `creator: o.W` | WIRED |
| submit | co-sign | `cosign()` with the exit from the stored row | WIRED |
| status | paused UI | `/api/status` `paused` -> `launch-flow` callout + `SignButton` | WIRED |
| landed row | step 5 + coin page | `getView` poll -> `LaunchLive`; facts -> `/coin/[mint]` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
| --- | --- | --- | --- | --- |
| `/coin/[mint]` | proof sentence, CA, tx link | launches row facts written by `settle.ts` from the landed tx | Yes (staging shows the CyR56 facts: insta burn, signature) | FLOWING |
| step 2 receipt | fees, minimum | worker `/status` live chain read, cached 5 s | Yes (staging: fees 95/30 bps, min 2,500,000) | FLOWING |
| coin image | `image_cid` | ipfs.io URL | Gateway returns 429 | STATIC (blank), WARNING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Lint | `pnpm lint` (biome ci) | 158 files, exit 0 | PASS |
| Typecheck | `pnpm typecheck` | exit 0 | PASS |
| Unit tests | `pnpm test` (one pass) | 23 files, 117 passed, 1 skipped, exit 0 | PASS |
| Staging health | GET /api/health | 200 `{"ok":true}` | PASS |
| Staging status | GET /api/status | 200, devnet, fees 95/30, minLamports 2500000, paused null | PASS |
| Coin page | GET /coin/CyR56...Pbndr | 200, "Dev holds 0 launch supply", CA, Solscan devnet tx link | PASS |
| Launch landed | public devnet `getSignatureStatuses` (read only) | finalized, err null, slot 513986869 | PASS |
| Mint metadata | public devnet `getAccountInfo` (read only) | Token-2022, name "BONDR e2e EX8EUJ", URI on ipfs.io, updateAuthority null | PASS (URI host is a warning) |
| Metadata reachable | GET ipfs.io / gateway.pinata.cloud for both CIDs | 429 / 200 | FAIL on ipfs.io (WARNING) |

The checks ran at 09:28 IST on the clean tree at d3cec5e. At 09:30, other work started editing 8 files in the working tree (an uncommitted PINATA_GATEWAY change to `pinata.ts`, `rules.ts`, `coin-identity.tsx`, `launch-live.tsx`, `next.config.ts` and `status.ts`). That work is neither verified nor deployed, and this report does not cover it.

### Probe Execution

No probes declared or present (`scripts/*/tests/probe-*.sh`). Step 7c skipped.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
| --- | --- | --- | --- |
| PLAT-01 | Phantom only, connect/disconnect anywhere | SATISFIED (real extension NEEDS HUMAN) | SC1 |
| PLAT-02 | Consent before storing wallet data | SATISFIED | Signed consent before upsert; session-only wallet |
| PLAT-03 | Short terms page linked from footer and consent | SATISFIED | Contact handle placeholder (Info) |
| PLAT-04 | Mobile, tablet, desktop | SATISFIED | Staging 37/37, 36 PNGs |
| LAUNCH-01 | Form fields and limits | SATISFIED | `rules.ts`, shared by all three tiers |
| LAUNCH-02 | Minimum dev buy and exit gate | SATISFIED | SC2 |
| LAUNCH-03 | One Phantom tx: bndr create, buy, sell/burn | NEEDS HUMAN | Landed with fake Phantom; real-Phantom launch not recorded |
| LAUNCH-04 | Co-sign only on the exact message with the exit | SATISFIED | `cosign.ts`, tests, devnet tamper refusal |
| LAUNCH-05 | Success screen within 5 s with proof, tx, CA copy, coin button | SATISFIED | 2.4 s on staging; components present |
| LAUNCH-06 | Paused state | SATISFIED | SC5 |
| LAUNCH-07 | Metadata and image pinned to Pinata before signing | SATISFIED with WARNING | Pinned (200 on Pinata); the on-chain URI's gateway refuses (429) |
| FEE-10 | W from master seed, worker only, web holds no secrets | SATISFIED | `keys.ts derive` used only in the worker; WEB_ENV allowlist; `forbiddenEnv`; bundle gate |
| OPS-01 | Sentry on web and worker | SATISFIED | SC6 |

No orphaned requirements: all 13 phase-2 IDs in REQUIREMENTS.md are claimed by plans. REQUIREMENTS.md still lists all 13 as Pending, and ROADMAP Phase Details says "15/18 plans executed" while the progress table says 18/18. Both are doc updates for the orchestrator after sign-off.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| (phase files) | - | TBD / FIXME / XXX | none found | - |
| (phase files) | - | TODO / placeholder / not implemented | none found | - |
| (phase files) | - | files over 300 lines | none found | - |
| `apps/web/lib/pinata.ts` | 7 | Hard-coded ipfs.io gateway written into immutable on-chain URIs | WARNING | Wallets, explorers and the coin page cannot load the metadata or image |
| `packages/core/src/rules.ts` | 8 | `URI_PREFIX` allows only ipfs.io | WARNING | Blocks any gateway change until updated (the in-flight edit touches this) |
| `apps/web/app/terms/page.tsx` | ~118 | "@BONDR on X (handle to be confirmed before go-live)" | Info | Owner approved the copy as is; must be set before mainnet |

### Open Items Classification (requested)

| Item | Classification | Severity | Reason |
| --- | --- | --- | --- |
| IPFS gateway (ipfs.io 429 for metadata and image; URIs immutable) | Open gap, owner decision pending, not deferred | WARNING (must fix before any mainnet launch) | SC3/LAUNCH-07 literally hold (pinned on Pinata), but the on-chain pointer does not resolve. No later phase names this. An uncommitted fix is in progress in the working tree. |
| Terms placeholder contact handle | Accepted by owner ("approved ... as they stand") | Info | PLAT-03 is met. The copy itself says "before go-live". Add it to the Phase 7 checklist. |
| Owner's real Phantom launch signature and warning text not supplied | Unmet 02-18 acceptance criterion | WARNING, human verification | The only evidence for the real-extension half of SC3 and LAUNCH-03 is missing. |
| worker-core WR-08 | Accepted deferral | Deferred to Phase 5 | Phase 5 SC2 owns the forced bond. Not called in Phase 2. |
| worker-core IN-01 (dead `canRelease` guard) | Open, non-blocking | Info | `inFlight` subquery is the real protection |
| worker-core IN-02 (submit co-signs when the chain read fails during the BONDR migration window) | Open, owner decision | Info | Dev can pay a fee for a tx that fails on chain. Rare window. |
| worker-core IN-03 (solBack counts fee-recipient 0->n accounts as rent) | Open | Info | Inflates the displayed insta-sell SOL back; the proof of 0 supply is unaffected |
| worker-core IN-04 (pool-venue createCost preview understated) | Open | Info | Preview only |
| worker-core IN-07 (bad submit fails the prepared row) | Open | Info | Rare double-click race |
| worker-core CR-01 residual: table-close scheduler not built | Open, not owned by a later phase | Info | Rent is bounded by signed consent, 10 tables per wallet per day and the 0.05 SOL ops floor. Track explicitly (Phase 5 or 6). |
| web IN-03 (CSP only frame-ancestors, no HSTS) | Open | Info | Address before mainnet (Phase 7) |
| web IN-04 (image pick race, blob URLs not revoked) | Open | Info | Cosmetic and memory only |
| web IN-05 (public GETs unlimited) | Open | Info | Neon CU-h quota exposure on `/coin/[mint]` misses (cached 1 min) |
| web IN-06 (`/api/sentry-test` GET with side effects) | Open | Info | Safe only while SENTRY_TEST_ROUTE is unset (02-16 deleted it on staging). Not probed: a GET would emit events. |
| web IN-07 (step 4 failed rows and the copy-chip hint not announced) | Open | Info | Screen-reader gap that axe does not catch |
| 02-14 Sentry geo note | Open | Info | Server events carry the Railway host geo, not the user's |

### Human Verification Required

#### 1. Real Phantom launch on staging

**Test:** On desktop Chrome with Phantom (Testnet Mode, devnet-funded), open the staging URL. Connect, accept consent, launch with the minimum dev buy and either exit, then open the coin page.
**Expected:** Phantom signs without changing the message, the launch lands, and the success screen shows within about 5 s. Record the signature and any Phantom warning text in 02-18-SUMMARY.md.
**Why human:** Needs the real extension. Every recorded launch used the Playwright Wallet Standard stub.

#### 2. IPFS gateway decision

**Test:** Pick the gateway (Pinata dedicated via PINATA_GATEWAY recommended). Then commit, test and redeploy with approval. Or record an override accepting ipfs.io on devnet only.
**Expected:** A new launch's on-chain URI and image answer 200.
**Why human:** Owner decision plus an outward-facing redeploy.

### Gaps Summary

No success criterion failed. The launch path works end to end on staging: the code enforces the co-sign gate, the chain shows a finalized `bndr` mint, and the token page shows "Dev holds 0 launch supply". Two items stop a clean pass:

1. **No real-Phantom launch on record.** The SC3 and LAUNCH-03 claim "one Phantom signature" has only fake-wallet evidence, and the 02-18 acceptance criterion for the owner's signature is unmet.
2. **Unreachable metadata URIs.** On-chain metadata URIs point at a gateway that now refuses them, and the URIs cannot be changed afterwards. This is harmless on devnet but must be fixed before any mainnet coin.

Everything else is either an accepted deferral (WR-08 to Phase 5, the owner-approved terms copy) or a non-blocking Info item.

---

_Verified: 2026-10-23_
_Verifier: Claude (gsd-verifier)_

## Human verification result (2026-10-23)

The owner launched one coin on staging with the real Phantom extension: signature `3khSgMFGcYXdQfLFxuvt9BG5rDTtbcWqVXVb98xjbFdcwFiUvZiv7L4qZa1x8VdjBsvyXhbAHBzE7XEKLKeAHQCT`, finalized on devnet with no error, mint `HHNKkxQxFXTzcmRnuTPJmaNuSe34Cxyemspf1Wofbndr`. Phantom showed only the new-domain warning. The worker co-signed (no cosign_refused), so the message bytes held through the real extension. The metadata URI and image use the Pinata dedicated gateway and load, which also closes the ipfs.io gap for new coins. Criterion 3 is verified; status moves from human_needed to passed.
