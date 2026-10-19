# Phase 2: Launch Flow - Context

**Gathered:** 2026-10-19
**Status:** Ready for UI contract and planning

<domain>
## Phase Boundary

A dev connects Phantom, accepts consent, fills the launch form and signs one transaction. That transaction:
- creates a `bndr` vanity mint with creator = the coin's W
- pairs it with the BONDR stand-in quote
- buys the dev buy and sells or burns it

The dev then sees the success screen with "Dev holds 0 launch supply", the exit tx link, the full contract address with a copy button, and a link to a bare token page.

Also in this phase:
- the paused state (kill switch, or BONDR awaiting migration)
- the terms page and the consent prompt
- Sentry on web and worker
- a shareable staging deploy on Railway + Neon (devnet)

Requirements: PLAT-01..04, LAUNCH-01..07, FEE-10, OPS-01.

Not in this phase:
- lists and charts (Phase 3)
- trading (Phase 4)
- fee engine jobs (Phase 5)
- admin dashboard (Phase 6)
- mainnet (Phase 7)

</domain>

<decisions>
## Implementation Decisions

### Network and environment
- **D-01:** The Phase 2 app launches coins on devnet.
  - The BONDR stand-in is a devnet SOL-paired pump coin owned by the treasury key. Reuse the refreshed Phase 1 stand-in or create a fresh one.
  - Devnet refuses `creator_fee_bps` 150 (`creator_fee_configurable = false`), so devnet coins use pump's default creator fee. The 150 bps path is already proven on the fork.
  - The UI must read the creator fee from live chain config and display what the coin actually has, never a hardcoded 1.5%.
- **D-02:** Network comes from env (`SOLANA_NET=devnet|mainnet`). Mainnet stays disabled until Phase 7: the app must refuse to start the launch path with mainnet unless an explicit flag is set.

### Hosting
- **D-03:** Deploy a shareable staging environment in this phase:
  - Railway project with two services, `web` (Next.js 16) and `worker` (Node)
  - Neon Postgres
  - Sentry for both services
  Every later phase ends with a staging link.
- **D-04:** The Neon project is created through the Neon MCP during execution. That is an outward-facing action, so confirm with the owner before creating it. Railway project and service creation also need owner confirmation before the first deploy.

### Accounts and secrets
- **D-05:** The owner already has Pinata, Sentry, Railway and Neon accounts.
  - The repo-root `.env` already holds `pinata_api_key`, `pinata_secret_api_key` and `pinata_jwt` (plus `helius_api_key`).
  - Sentry DSNs are not in `.env` yet. Execution must ask the owner for the web and worker DSNs, or create the Sentry projects with their approval.
  - Keep `.env.example` in sync with every variable name and no values.
  - Railway variables are set one name per `railway variable set` command (agencybook lesson: a multi-name call corrupted a value).
- **D-06:** Wallet secrets (master seed, ops, treasury, mint keys) live in the worker only. Web never holds them (agencybook WEB_FORBIDDEN pattern).

### Terms and consent
- **D-07:** Claude drafts:
  - A short plain-English terms page: hobby project, memecoins are risky, BONDR controls each coin's pre-bond creator fees under the published rules, what BONDR stores (wallet address, launches and their transactions), no warranty.
  - A one-screen consent prompt shown on first Phantom connect, before anything about the wallet is stored.
  The owner reviews the copy before Phase 2 sign-off. Legal stays minimal per AGENTS.md.

### Carried forward (locked by PROJECT.md and Phase 1)
- **D-08:** Phantom is the only wallet.
- **D-09:** Launch transaction shape, from Phase 1 evidence:
  - one v0 tx: create_v2 + exact-out dev buy (SOL to BONDR via multi_hop, then `buy_v3` exact coin amount) + exit
  - the exit is insta sell back to SOL or insta burn; Streamflow lock is shown disabled ("coming later")
  - the per-coin lookup table is created by the server while preparing; ops pays the rent
  - measured 780/881 bytes; the table is mandatory once BONDR has migrated
- **D-10:** Dev buy minimum is 0.25 SOL, measured on the SOL input. Exit choice starts unselected.
- **D-11:** Vanity mint suffix is `bndr` (case-sensitive), served from a pre-ground pool.
- **D-12:** Sign order follows agencybook arm A. Phantom signs first. The server checks the signed message is byte-identical to what it built and that it contains the chosen exit, then adds the mint signature and sends. Otherwise it refuses.
- **D-13:** The UI follows the approved round 2 mockups in `.planning/mockups/` (launch.html steps 1-5, consent.html, the success screen with copy-CA). A UI-SPEC is produced by gsd-ui-phase before planning.
- **D-14:** The 14-day freshness rule applies to every new dependency (published at least 14 days before install). The exceptions are the pinned pump SDKs (`@pump-fun/pump-sdk` 4.1.0, `@pump-fun/pump-swap-sdk` 2.1.0).
- **D-15:** apps/web imports only pure `@bondr/core` modules. A Biome `noRestrictedImports` rule enforces it. Next.js needs `transpilePackages` for the raw-.ts core. Record the type-stripping constraint in the core README (STATE.md concern from the Phase 1 review).
- **D-16:** The worker uses the Phase 1 send semantics (`landed | failed | unknown`, never retry unknown before expiry) and the configurable priority fee.

### Decisions after research (owner, 2026-10-19)
- **D-17 (amends D-10):** The dev buy minimum scales from live chain config: 0.25 SOL x (live initial virtual quote reserves / mainnet 30 SOL). It is exactly 0.25 SOL on mainnet and about 0.0025 SOL on devnet. UI copy and presets read the live value.
- **D-18:** Build the BONDR-pool route in Phase 2. When the BONDR stand-in has migrated, the launch builder routes the SOL to BONDR hop (and the insta-sell BONDR to SOL hop) through BONDR's PumpSwap pool. Prove it on the fork. Launches are paused only during the seconds-long complete-but-unmigrated window (6107), never after migration.
- **D-19:** Claude creates the two Sentry projects (Next.js web, Node worker) with the Sentry CLI, using an owner-provided auth token `sentry_auth_token` in .env. Use Sentry v11 `dataCollection` with an explicit restrictive config, plus a beforeSend filter that strips base58 wallet-shaped strings (32-44 chars). `sendDefaultPii` no longer exists in v11.
- **D-20:** Staging reuses the Phase 1 devnet master seed (ops already holds about 2.9 devnet SOL), copied into a Railway worker variable. Mainnet always gets a brand-new seed in Phase 7, never this one.
- **D-21 (from research):**
  - Pin shadcn 4.21.2, lucide-react 1.52.0 and radix-ui 1.6.7 (14-day rule). Never run `shadcn@latest`.
  - The display font is `Big_Shoulders` with the opsz axis; `Big_Shoulders_Display` does not exist in next 16.3.8.
  - Vanity mints are derived from the master seed plus an index and ground in Node. Only the index and pubkey are stored, never a mint secret.

### Claude's Discretion
- **Co-sign and W supply architecture** (STATE.md concern).
  - Default: the worker exposes a small private HTTP signer on Railway private networking, authenticated with a shared secret. Web calls `prepare` and gets the built unsigned tx: W pubkey derived in the worker, a mint from the vanity pool, the per-coin lookup table created by ops.
  - The browser gets Phantom's signature. Web posts the signed tx to the worker's `submit`, which verifies (D-12), co-signs with the mint key, sends and records the launch.
  - The planner may choose another design if it keeps every secret out of web.
- Vanity grinding method and pool size: `solana-keygen grind`, or a Node grinder in the worker, with an alert below a threshold.
- DB schema, migrations (Drizzle), rate limiting on `prepare`, and metadata/image validation limits.
- The bare token page content in Phase 2: header, proof badge, contract address. Phase 3 fills it.

</decisions>

<canonical_refs>
## Canonical References

### BONDR spec and prior phase
- `.planning/PROJECT.md` — Fee Mechanic (updated with Phase 1 evidence), Key Decisions, Risks
- `.planning/REQUIREMENTS.md` — PLAT-01..04, LAUNCH-01..07, FEE-10, OPS-01
- `.planning/ROADMAP.md` — Phase 2 success criteria
- `.planning/STATE.md` — Blockers/Concerns (web import rule, W supply, BONDR SOL-pair path for Phase 7)
- `.planning/phases/01-chain-spike/01-10-SUMMARY.md`, `01-VERIFICATION.md` — what is proven, with measured sizes
- `scripts/spike/results/index.html` — evidence page

### Design
- `.planning/design/DESIGN-BRIEF.md` — direction, tokens, motion, the bond motif
- `.planning/mockups/launch.html`, `consent.html`, `token.html`, `tokens.css`, `mock.js` — approved round 2 mockups
- `.planning/mockups/screenshots/` — reference screenshots at 390/768/1440

### Code
- `packages/core/src/launch.ts`, `send.ts`, `alt.ts`, `keys.ts`, `net.ts`, `route.ts`, `pump.ts` — Phase 1 foundation to reuse
- `scripts/spike/stages/launch.ts` — working launch assembly on devnet and fork

### agencybook reference (read-only)
- `/Users/uzi/agencybook-phase-15/packages/core/src/launch/build.ts`, `sign.ts`, `verify.ts` — sign order A and message verification
- `/Users/uzi/agencybook-phase-15/apps/web/app/api/launch/prepare/route.ts`, `apps/web/lib/launch.ts` — prepare route and self-hosted metadata (BONDR uses Pinata instead)
- `/Users/uzi/agencybook-phase-15/apps/worker/src/main.ts`, `wallets.ts` — worker leader lock and pinned pubkeys
- `/Users/uzi/agencybook-phase-15/scripts/check-client-bundle.sh` — check that no SDK reaches the client bundle

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core`: launch builders (create + exact-out buy + exit), lookup table creation with a fresh slot per authority, send with program allowlist and status, HMAC key derivation, network guard, multi_hop routing, event decoding.
- The spike launch stage shows the full assembly order and the measured sizes.

### Established Patterns
- Biome lint with a 40-line function limit, Vitest, pnpm workspace, root tsconfig, raw .ts exports from core.
- Secrets read from the repo-root `.env` locally and from Railway variables in staging. The Helius key is never on argv.

### Integration Points
- New `apps/web` (Next.js 16, Tailwind, shadcn) and `apps/worker` (Node) import `@bondr/core`.
- Neon Postgres through Drizzle is shared by web and worker.

</code_context>

<specifics>
## Specific Ideas

- The success screen copy-CA control is already designed in `launch.html` step 5 (the owner asked for it). It is the primary post-launch action, next to "Open <SYMBOL>".
- On devnet the UI should show a small "DEVNET" badge, so nobody mistakes staging for mainnet.

</specifics>

<deferred>
## Deferred Ideas

None. The discussion stayed within phase scope.

</deferred>

---

*Phase: 02-launch-flow*
*Context gathered: 2026-10-19*
