# Phase 7: Go-Live - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-26
**Phase:** 07-go-live
**Mode:** --auto. The owner delegated gate choices. Each area took its recommended option without a question. Money and mainnet-funds choices were recorded as OWNER GATES, not as approvals.
**Areas discussed:** Mainnet switch, Production environment, Must-fix before mainnet, Contract check, CI and scripts, BONDR genesis and launch gating, Sniping, EVACUATE on mainnet, Rollout order

[auto] Selected all gray areas. No todos matched (todo.match-phase 7: 0).

---

## Mainnet switch

| Option | Description | Selected |
|--------|-------------|----------|
| Two flags plus an inventory | `SOLANA_NET=mainnet` and `ALLOW_MAINNET=1`, with each refusal listed and tested | ✓ |
| A single SOLANA_NET switch | Drop ALLOW_MAINNET | |
| A per-feature mainnet flag | One flag per refusal | |

**Choice:** [auto] Two flags plus an inventory of 13 refusal rows (recommended default)
**Notes:** The inventory came from a grep of `mainnet` and `devnet` guards across apps and packages. The keys `Net` type has no mainnet member today. The fork guard is unchanged.

## Production environment

| Option | Description | Selected |
|--------|-------------|----------|
| Railway `production` env in project bondr, Neon branch in the same project, own seed, external treasury | Reuses the staging layout, with keys separated | ✓ |
| A separate Railway project and Neon project | More isolation, and a second Neon quota but a second bill | |
| Derived treasury on mainnet | No change | |

**Choice:** [auto] Same project, new environment and branch. Own seed. TREASURY_PUBKEY external (recommended)
**Notes:** Creating the environment (G-1), the treasury address (G-2), seed custody (G-3) and any plan change (G-11) are OWNER GATES. The domain is trybondr.fun, apex primary, www redirects. SITE_URL is set on web and worker.

## Must-fix before mainnet

| Option | Description | Selected |
|--------|-------------|----------|
| Fix v1 ingest, fold IN-B-02, T-06-03-03 and IN-W-04, and replace the terms contact | All small, all pre-mainnet | ✓ |
| Fix v1 only | Leave the security informationals | |

**Choice:** [auto] Fold all of them (recommended)
**Notes:** The v1 fix method is Claude's discretion, proven with a captured devnet v1 fixture. Contact default: hello@trybondr.fun with free forwarding.

## Contract check (OPS-02)

| Option | Description | Selected |
|--------|-------------|----------|
| In the worker: at boot, weekly on the batch timer, and on demand from admin | RPC only, pauses switches on a mismatch | ✓ |
| A GitHub Actions cron | Cannot pause the worker without a new route and a secret in CI | |
| A Railway cron service | An extra service | |

**Choice:** [auto] Worker-based check with per-network profiles. A mismatch turns all switches off with no auto-resume. A program redeploy alone is a warning only (recommended)

## CI and scripts (OPS-03, OPS-04)

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub Actions with no secrets, a Postgres service container, and an @smoke Playwright set | No Neon CU spent, no secrets in CI | ✓ |
| CI against a Neon CI branch | Costs quota and needs a secret | |
| CI with Helius devnet | Needs a secret, and the tests are flaky | |

**Choice:** [auto] No-secret CI with a Postgres container. setup, dev, test and deploy scripts. `deploy.sh production` needs a typed confirmation (recommended)

## BONDR genesis and launch gating (OPS-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Through the launch page in genesis mode (admin wallet only, SOL pair, creator = treasury, insta burn) | Matches PROJECT.md default 4, "through BONDR" | ✓ |
| A one-off script | Not "through BONDR" | |
| Require BONDR to bond before child launches | Delays launches; the 6107 pause already covers the window | |

**Choice:** [auto] Genesis mode with BONDR_QUOTE_MINT unset. Child launches open after the mint is set, the check passes, the pool holds at least 100 mints and the owner flips the switch. BONDR need not bond first (recommended)
**Notes:** Genesis timing and dev buy (G-5), the engine on (G-8) and opening launches (G-9) are OWNER GATES. The owner claims BONDR's creator fees on pump.fun with the treasury wallet.

## Sniping

| Option | Description | Selected |
|--------|-------------|----------|
| Sender for the launch with the tip inside the dev-signed tx, plus "sniped %" | SNIPING.md plan items 1-3 | ✓ |
| Sender only | No visibility | |
| Exclusion lists or delayed listing | Nothing to exclude from in v1 | |

**Choice:** [auto] Sender plus sniped %, with honest copy (recommended)
**Notes:** Tip amount 0.001 SOL vs 0.000005 SOL is OWNER GATE G-6 (creators pay it). Tracked as new requirement LAUNCH-08.

## EVACUATE on mainnet

| Option | Description | Selected |
|--------|-------------|----------|
| Allow `on` on mainnet only with an external TREASURY_PUBKEY, and add a runbook | The seed-leak response actually protects funds | ✓ |
| Keep it devnet-locked | PROJECT.md's leak response would not exist on mainnet | |
| Allow it on mainnet with the derived treasury | The attacker could derive the destination | |

**Choice:** [auto] Code allows it with the treasury precondition. Production starts at simulate (recommended)
**Notes:** Flipping production to `on` is OWNER GATE G-7.

## Rollout order

**Choice:** [auto] Merge with CI green and fork rehearsals passed, then G-1 dark deploy, G-2 and G-3 keys, G-4 ops funding, G-5 genesis, G-8 engine on, G-6 and G-10 decided, G-9 launches on, and G-7 at any time after G-2.

## Claude's Discretion

- The v1 ingest method.
- The IDL comparison depth in the contract check.
- The smoke spec list.
- The Postgres version in CI.
- VANITY_THREADS on production.
- The dev.sh runner.
- The www redirect mechanism.
- The genesis-mode status reason.
- The mainnet ops floor value within G-4.

## Deferred Ideas

- The Meteora DBC lane (parked by the owner).
- Separate local and staging seeds.
- Railway IaC.
- Sniper exclusion lists and delayed listing.
- Lookup table rent reclaim.
- A leader lock, multiple replicas and a trading kill switch.
- Site-wide burn totals.
- The Phase 6 Designer polish notes.
