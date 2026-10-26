---
phase: 07-go-live
plan: 04
subsystem: worker, core
tags: [mainnet, env, keys, treasury, evacuate, tdd]
requires: [07-01]
provides:
  - "core Net = devnet | fork | mainnet; rpcUrl/wsUrl give the Helius mainnet host; connect('mainnet') refuses a local host and any genesis but mainnet"
  - "env.ts: launchNet devnet|mainnet behind ALLOW_MAINNET=1; loadEnv returns treasury: PublicKey and treasuryExternal; evacuateAllowed(net, treasuryExternal)"
  - "FeeDeps.treasuryExternal; fee-boot, admin-overview, admin-inspect read env.treasury"
  - "inspect(conn, sig, known, net): explorer link follows the net"
affects: [07-17 genesis mode, 07-22 runbook docs, every later plan that builds FeeDeps or a WorkerEnv literal]
key-files:
  created: []
  modified:
    - packages/core/src/keys.ts
    - packages/core/src/net.ts
    - packages/core/src/net.test.ts
    - packages/core/src/keys.test.ts
    - apps/worker/src/env.ts
    - apps/worker/src/env.test.ts
    - apps/worker/src/fee-boot.ts
    - apps/worker/src/fee-send.ts
    - apps/worker/src/admin-evacuate.ts
    - apps/worker/src/admin-evacuate.test.ts
    - apps/worker/src/admin-inspect.ts
    - apps/worker/src/admin-overview.ts
    - apps/worker/src/admin-routes.ts
    - apps/worker/src/trade-quote.ts
    - apps/worker/src/status.test.ts
    - scripts/spike/results.ts
    - scripts/spike/stages/engine-bond.ts
    - apps/worker/README.md
    - .env.example
key-decisions:
  - "07-04: TREASURY_PUBKEY is compared against ops, the configured lane's buyback and the derived treasury under the mainnet net; errors name the variable only; equal to ADMIN_WALLET is a console warning, not a refusal"
  - "07-04: evacuateAllowed is devnet, or mainnet with treasuryExternal; boot and the loop call the same function; the loop reason keeps the devnet_only name the web maps"
  - "07-04: the spike keeps its own Net = Exclude<core Net, mainnet> in scripts/spike/results.ts (D-03)"
requirements-completed: []
duration: 35min
completed: 2026-10-26
---

# Phase 7 Plan 04: Mainnet Net, Keys, External Treasury and EVACUATE Summary

**The worker now boots on mainnet only with SOLANA_NET=mainnet plus ALLOW_MAINNET=1 and a valid TREASURY_PUBKEY that the seed cannot derive. Core reaches mainnet only from a remote host reporting the mainnet genesis, and mainnet key ids are separate from devnet and fork ones. EVACUATE=on is accepted on devnet, and on mainnet only with the external treasury, through one predicate shared by boot and the execute loop.**

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Mainnet in core Net, rpcUrl, wsUrl and the genesis guard | b184c9d |
| 2 | launchNet mainnet, the external treasury and its three callers | 13c9943 |
| 3 | EVACUATE on mainnet only with the external treasury | 879536f |

## Evidence

- net.test.ts and keys.test.ts: 17 passed. The tests stub fetch and record hosts, with no network access. Mainnet calls only mainnet.helius-rpc.com and rejects the devnet genesis. The fork still rejects a non-local host and accepts local plus mainnet genesis plus Surfpool. Red was checked before the change.
- env.test.ts: 9 passed. Covered: the double flag; fork and unknown nets refused; the external treasury accepted; missing, malformed, non-round-trip, PDA, ops, buyback and derived-treasury values each refused, with no value in the message; devnet ignores TREASURY_PUBKEY; evacuateAllowed in four rows; mainnet ADMIN_EVACUATE=on accepted.
- admin-evacuate.test.ts: a new mainnet case. With treasuryExternal false there is no intent and the loop throws Fail. With true, an intent is created and the loop passes.
- admin-inspect.test.ts: the mainnet explorer link has no cluster suffix.
- `rg "treasury\(seed, net\)\.publicKey|treasury\(env\.seed, env\.net\)\.publicKey" apps/worker/src`: no match. `cluster=devnet` appears only inside the net ternary. `net !== "devnet"`: no match in admin-evacuate.ts or env.ts.
- scripts/spike/keygen.ts is unchanged. env.ts is 151 lines and admin-evacuate.ts is 285.
- `pnpm typecheck`, `pnpm lint`: clean. `vitest --project unit`: 82 files, 623 passed, 1 skipped.

## Deviations from Plan

1. **[Rule 3 - Blocking] scripts/spike/results.ts defines `Net = Exclude<CoreNet, "mainnet">`.** Without it, page.ts's `Record<Net, string>` fails typecheck. It also keeps the spike devnet and fork only at the type level (D-03).
2. **[Rule 3 - Blocking] `inspect()` takes a `net` argument**, and admin-routes passes `o.env.net`. The inspector had no other way to know the net. Test calls and env literals in admin-inspect, admin-overview, admin-routes and status tests were updated: the status.test launchNet case now asserts mainnet is accepted with the flag.
3. **[Rule 3] scripts/spike/stages/engine-bond.ts sets `treasuryExternal: false`**, because FeeDeps now requires it.
4. **adminWallet is renamed to `exactKey`.** ADMIN_WALLET and TREASURY_PUBKEY share the round-trip parse.
5. **[Docs] The apps/worker/README.md EVACUATE line now states the D-37 rule.** The web copy is unchanged. The `devnet_only` reason name stays because use-evacuate.ts maps it. 07-22 docs may want to rename the copy.

## Notes for later plans

- Any FeeDeps literal must set `treasuryExternal`. Any WorkerEnv test literal that reaches overview, knownKeys or feeDeps needs `treasury`.
- The `buyback` lane type is still `"local" | "staging"`. When 07-xx adds the `production` lane (D-11), treasuryFrom's lane parameter widens with it.
- BONDR_QUOTE_MINT is still required at boot. Genesis mode comes in 07-17.

## Threat Flags

None. T-07-04-01..05 are mitigated as planned and tested.

## Self-Check: PASSED

- FOUND commits b184c9d, 13c9943, 879536f
