# Walking Skeleton - BONDR

**Phase:** 1
**Generated:** 2026-10-19

## Capability Proven End-to-End

Built in two plans: 01-01 (workspace, `packages/core` pump/net/keys, idempotent `pnpm spike:keys`) and 01-02 (results contract, run, config stage, check, page). The owner runs `SPIKE_NET=devnet pnpm spike && SPIKE_NET=devnet pnpm spike:check && pnpm spike:page`. One live devnet read goes through `packages/core` (SDK loader, network guard, key derivation) into `scripts/spike/results/devnet.json`, gets asserted by the checker, and shows up on a static HTML results page. Every later spike step plugs into the same pipe: a stage builds through `packages/core`, sends, measures, records a row, the checker asserts it, and the page shows it. The page never depends on the check: failed rows show as FAIL with their code, and required steps that never ran show as NOT RUN.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language and runtime | TypeScript run directly by Node 24 (type stripping), `.ts` import extensions, `tsc` 7.0.2 for typecheck only (`noEmit`) | No build step; agencybook pattern (tsconfig.base.json copied) |
| Workspace | pnpm 10 workspace: `packages/*` only; root holds `scripts/` | D-09: minimal skeleton. Phase 2 adds `apps/web` and `apps/worker` |
| Chain library | `packages/core` (`@bondr/core`, exports `./*` -> `./src/*.ts`), server and worker only | D-06, D-07: Phase 2+ imports the same modules |
| Pump SDK loading | Only `packages/core/src/pump.ts` loads `@pump-fun/pump-sdk` 4.1.0 and `@pump-fun/pump-swap-sdk` 2.1.0, via `createRequire` | D-08; the pump-sdk ESM build crashes under plain Node 24; web must never bundle the SDKs |
| Solana client | `@solana/web3.js` 1.99.0 `Connection` (built-in 429 retry), v0 messages, address lookup tables | The SDKs are web3.js 1.x; one client, not two |
| Keys | One 32-byte master seed per network outside the repo (`~/.bondr-spike/<net>/master.seed`, mode 0600). Every key is `Keypair.fromSeed(HMAC-SHA256(master, "<role>:<net>:<id>"))` | D-06 W derivation; PROJECT.md "all W keys HMAC-derived from one master seed". Nothing per token to store |
| Network guard | `packages/core/src/net.ts`: devnet requires the devnet genesis hash; the fork requires a 127.0.0.1 host; the RPC URL (holds the Helius key) is never logged and errors are redacted | Never send to real mainnet in Phase 1 (D-01); never leak the key |
| Send path | `packages/core/src/send.ts`: program allowlist, v0 compile, sign, send, confirm, read CU from confirmed meta, wire bytes from the serialized tx | One send path (agencybook send.ts core). Measures what SPIKE-02 needs |
| Data layer | JSON files: `scripts/spike/results/<net>.json` (rows plus named public-key state). No database | D-13; Postgres and Drizzle arrive in Phase 2 |
| Evidence UI | `scripts/spike/page.ts` writes one static `scripts/spike/results/index.html`. No server, no framework, no JavaScript | D-13 |
| Verification | Vitest 5.0.5 for pure math and keys; `scripts/spike/check.ts` asserts chain evidence per row (rules live next to each stage) | D-09; Nyquist contract in 01-VALIDATION.md |
| Format and lint | Biome 2.5.15 (`biome ci .`) with `noExcessiveLinesPerFunction` at 40 lines (tests exempt) | agencybook pin; AGENTS.md formatter and 40-line function rules enforced by the linter |
| Networks | Devnet through Helius for every step devnet supports; Surfpool 1.6.1 mainnet fork on 127.0.0.1:18899 for the rest | D-01 hybrid |
| Deployment | None. Local commands only (`pnpm spike:keys`, `pnpm spike`, `pnpm spike:fork-up`, `pnpm spike:check`, `pnpm spike:page`, and `pnpm spike:all`, which always writes the page and then exits with the run and check status) | Phase 1 has no hosting; Railway arrives later |

## Directory Layout

```
package.json, pnpm-workspace.yaml, biome.json, tsconfig.base.json, tsconfig.json (one tsconfig for scripts and packages)
packages/core/src/      pump.ts net.ts keys.ts config.ts send.ts alt.ts math.ts launch.ts
                        sharing.ts route.ts curve.ts collect.ts trade.ts bond.ts events.ts
                        (+ tests, fixtures/, README.md)
scripts/spike/          run.ts results.ts keygen.ts check.ts page.ts fund.ts fork.sh all.sh README.md
scripts/spike/nets/     devnet.ts fork.ts        ordered stage lists per network
scripts/spike/stages/   one file per stage, each exporting { name, rules(net), run(ctx) }
scripts/spike/results/  devnet.json fork.json index.html   (committed evidence)
```

## Stack Touched in Phase 1

- [x] Project scaffold: pnpm workspace, Biome, tsc typecheck, Vitest
- [x] Routing: not applicable (no web app in Phase 1, D-09). The static page is one file
- [x] Data: one real write (run.ts writes results JSON row by row, before any exit) and one real read (check.ts and page.ts read it). Chain reads and writes on devnet and the fork
- [x] UI: one static HTML results page generated from the JSON. No interactive element by decision D-13
- [x] Deployment: documented local run commands that exercise the whole pipe

## Out of Scope (Deferred to Later Slices)

- apps/web, apps/worker, Next.js, Postgres, Drizzle, Railway, Sentry (Phase 2+)
- Vanity `bndr` mint grinding and the Phantom co-sign path (Phase 2)
- Helius Sender / private send path (Phase 2 launch, Phase 5 forced bond; deferred in CONTEXT.md)
- Streamflow lock (v2, LOCK-01)
- Real mainnet transactions (Phase 7)
- Indexer, candles, lists (Phase 3)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without changing its decisions:

- Phase 2: Launch Flow (apps/web + apps/worker import `@bondr/core` launch, alt, send, keys)
- Phase 3: Indexer, Lists and Token Page (core events.ts decoding feeds Postgres)
- Phase 4: Trading (core route.ts multi_hop builders)
- Phase 5: Fee Engine and Public Ledger (core collect.ts, trade.ts forced bond, sharing.ts finalize)
- Phase 6: Admin Dashboard
- Phase 7: Go-Live (core config.ts live reads feed the weekly contract check)
