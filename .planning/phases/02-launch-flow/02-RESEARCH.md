# Phase 2: Launch Flow - Research

**Researched:** 2026-10-19
**Domain:** Next.js 16 web app + Node worker signer, Phantom (Wallet Standard), pump.fun one-tx launch with server co-sign, Pinata, Neon/Drizzle, Sentry, Railway
**Confidence:** HIGH for the chain path and the reused agencybook patterns (both have on-chain or production evidence); MEDIUM for hosting and Sentry details; LOW only where marked

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Network and environment
- **D-01:** The Phase 2 app launches coins on devnet.
  - The BONDR stand-in is a devnet SOL-paired pump coin owned by the treasury key. Reuse the refreshed Phase 1 stand-in or create a fresh one.
  - Devnet refuses `creator_fee_bps` 150 (`creator_fee_configurable = false`), so devnet coins use pump's default creator fee. The 150 bps path is already proven on the fork.
  - The UI must read the creator fee from live chain config and display what the coin actually has, never a hardcoded 1.5%.
- **D-02:** Network comes from env (`SOLANA_NET=devnet|mainnet`). Mainnet stays disabled until Phase 7: the app must refuse to start the launch path with mainnet unless an explicit flag is set.

#### Hosting
- **D-03:** Deploy a shareable staging environment in this phase:
  - Railway project with two services, `web` (Next.js 16) and `worker` (Node)
  - Neon Postgres
  - Sentry for both services
  Every later phase ends with a staging link.
- **D-04:** The Neon project is created through the Neon MCP during execution. That is an outward-facing action, so confirm with the owner before creating it. Railway project and service creation also need owner confirmation before the first deploy.

#### Accounts and secrets
- **D-05:** The owner already has Pinata, Sentry, Railway and Neon accounts.
  - The repo-root `.env` already holds `pinata_api_key`, `pinata_secret_api_key` and `pinata_jwt` (plus `helius_api_key`).
  - Sentry DSNs are not in `.env` yet. Execution must ask the owner for the web and worker DSNs, or create the Sentry projects with their approval.
  - Keep `.env.example` in sync with every variable name and no values.
  - Railway variables are set one name per `railway variable set` command (agencybook lesson: a multi-name call corrupted a value).
- **D-06:** Wallet secrets (master seed, ops, treasury, mint keys) live in the worker only. Web never holds them (agencybook WEB_FORBIDDEN pattern).

#### Terms and consent
- **D-07:** Claude drafts:
  - A short plain-English terms page: hobby project, memecoins are risky, BONDR controls each coin's pre-bond creator fees under the published rules, what BONDR stores (wallet address, launches and their transactions), no warranty.
  - A one-screen consent prompt shown on first Phantom connect, before anything about the wallet is stored.
  The owner reviews the copy before Phase 2 sign-off. Legal stays minimal per AGENTS.md.

#### Carried forward (locked by PROJECT.md and Phase 1)
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

### Claude's Discretion
- **Co-sign and W supply architecture** (STATE.md concern).
  - Default: the worker exposes a small private HTTP signer on Railway private networking, authenticated with a shared secret. Web calls `prepare` and gets the built unsigned tx: W pubkey derived in the worker, a mint from the vanity pool, the per-coin lookup table created by ops.
  - The browser gets Phantom's signature. Web posts the signed tx to the worker's `submit`, which verifies (D-12), co-signs with the mint key, sends and records the launch.
  - The planner may choose another design if it keeps every secret out of web.
- Vanity grinding method and pool size: `solana-keygen grind`, or a Node grinder in the worker, with an alert below a threshold.
- DB schema, migrations (Drizzle), rate limiting on `prepare`, and metadata/image validation limits.
- The bare token page content in Phase 2: header, proof badge, contract address. Phase 3 fills it.

### Deferred Ideas (OUT OF SCOPE)
None. The discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAT-01 | Connect with Phantom (only wallet) and disconnect from any page | Wallet Standard `getWallets()` filtered to `name === "Phantom"`, `standard:connect` / `standard:disconnect` / `standard:events`; wallet state in a root-layout client provider; silent reconnect. Pattern 2, Code Example 1 |
| PLAT-02 | Consent before BONDR stores anything about the wallet | localStorage consent flag checked client-side (no server call before Accept); Accept upserts `wallets` row; prepare refuses wallets without a row. Pattern 6 |
| PLAT-03 | Short terms page linked from footer and consent | Static server page `/terms`, copy in UI-SPEC; no research risk |
| PLAT-04 | Mobile, tablet, desktop | UI-SPEC breakpoints; Playwright screenshots at 390/768/1440 plus axe. Validation Architecture |
| LAUNCH-01 | Form: name (32), symbol (13), image, description, links | Pure `core/rules.ts` shared by client and server; name counted in UTF-8 bytes (agencybook rule); image magic-byte check. Pattern 7 |
| LAUNCH-02 | Dev buy >= minimum and exit chosen before launch enables | Minimum must scale by net (see Contradiction 1): `initialVirtualSolReserves / 120` = 0.25 SOL mainnet, 0.0025 SOL devnet |
| LAUNCH-03 | One Phantom tx: `bndr` mint, buy, sell or burn | `buildLaunch` (core) + per-coin table (core `alt.ts`) + derived vanity pool + `solana:signTransaction`. Patterns 3, 4, 5 |
| LAUNCH-04 | Co-sign only if message matches and contains exit | Port agencybook `sameMessage` + `signatureOk` + `completeLaunch`; add `exitPresent(message)`; state machine guard. Code Example 2 |
| LAUNCH-05 | Success within 5 s of confirmation with proof, exit link, CA copy, coin link | Worker writes `landed` from `getSignatureStatuses` err field at confirmation, client polls DB-backed status every 1 s. Pattern 8 |
| LAUNCH-06 | Paused state (kill switch, BONDR awaiting migration) | DB `settings.launches_enabled` + on-demand Q curve check (`complete` and no canonical pool) cached 5 s; enforced in worker prepare and submit, shown by web. Pattern 9 |
| LAUNCH-07 | Metadata and image pinned to Pinata before signing | Web route uploads image then JSON via `POST https://uploads.pinata.cloud/v3/files` with JWT; URI `https://ipfs.io/ipfs/<cid>` (80 chars). Pattern 10 |
| FEE-10 | W derived from master seed, used only in worker | `derive(master, "w", net, mint)` already in core `keys.ts`; seed only in worker env; Biome rule + client bundle check + web boot guard |
| OPS-01 | Sentry captures web and worker errors | `@sentry/nextjs` 11.4.0 and `@sentry/node` 11.4.0; v11 `dataCollection` restrictive config + base58 scrub. Pattern 11 |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- No emoji anywhere: code, UI, copy, alt text, comments, commits, docs.
- Files under 300 lines; functions under 40 lines (Biome `noExcessiveLinesPerFunction` already enforces 40, tests exempt); three directory levels maximum; a README.md in any directory with more than five files.
- Comments say why, never what. Mark deliberate shortcuts with `ponytail:` naming the ceiling and upgrade path. Dead code deleted.
- Never commit secrets; `.env` plus a committed `.env.example` (names only). Never print secret values.
- Ask before destructive or outward-facing actions: Neon project creation, Railway project/service creation, first deploy, setting secrets, creating Sentry projects (D-04, D-05).
- One runnable check per non-trivial change. Vitest already exists (4.1.11); Playwright is the team's eyes for UI.
- Every UI phase ends with Playwright screenshots at mobile, tablet and desktop widths; `audit` for accessibility before done.
- Default stack: TypeScript, Next.js, Tailwind + shadcn, pnpm, Vitest, Playwright, Railway. Postgres on Neon for multi-user.
- Branch per phase (`phase-02-launch-flow` is current); small atomic commits after green tasks.
- Ponytail ladder: reuse codebase, stdlib, platform, installed deps before adding anything.
- D-14 freshness rule: every new dependency at least 14 days old at install (cutoff for a 2026-10-19 install: published on or before 2026-10-05).

## Summary

Phase 1 left a working chain path: `buildLaunch` (create_v2 + exact-out dev buy + exit), `createTable` (per-coin lookup table with warm-up), `sendTx` with `landed | failed | unknown`, and HMAC key derivation. agencybook left a production-proven sign order A: Phantom signs a v0 message through Wallet Standard `solana:signTransaction` with no Solana library in the browser, and the server compares the raw message bytes, verifies the Ed25519 signature with `node:crypto`, adds the mint signature and sends. Phase 2 is mostly assembly of these two, plus a new web app, a small worker HTTP signer, a vanity pool, Pinata pinning, a DB, Sentry and a Railway deploy.

Research found one locked decision that breaks on devnet as written: the 0.25 SOL dev-buy minimum (D-10). Devnet pump curves are 100x cheaper than mainnet (`initialVirtualSolReserves` 0.3 SOL vs 30 SOL). A read-only quote against the live devnet stand-in shows a 0.25 SOL dev buy buys 61% of the stand-in's remaining curve and 85% of the child curve; two insta-burn launches would complete the stand-in. Phase 1 already used the scaled amount (`initialVirtualSolReserves / 120` = 0.0025 SOL) on devnet. The minimum must be read from live Global, which keeps 0.25 SOL on mainnet. A second gap: `buildLaunch` hardcodes the curve venue for the SOL to BONDR buy and both exit-sell hops, so a launch against a migrated BONDR is unproven. UI-SPEC's paused copy promises launches "unlock automatically when the pool is live", which today would turn into failing launches.

The cleanest vanity design is not to store mint secrets at all. Grind over `derive(master, "mint", net, index)` and store only `(index, pubkey)`. The grind costs about the same as random keys (33.9k vs 37.2k keys/s per thread in Node on this M4, about 5.5 min per `bndr` key per thread). It needs no encryption key, and the Mac can pre-fill the pool without any secret leaving it.

**Primary recommendation:** Build web (Next.js 16.3.8, no Solana library in the browser) plus a worker with a 4-route `node:http` signer on Railway private networking. Reuse core `buildLaunch` / `createTable` / `sendTx` and port agencybook's byte-compare co-sign. Scale the dev-buy minimum from live Global (owner to confirm). Use seed-derived vanity mints.

## Research Contradicts or Refines Locked Decisions

| # | Decision | Finding | Recommendation |
|---|----------|---------|----------------|
| 1 | D-10 "minimum 0.25 SOL" applied on devnet (D-01) | Devnet `initialVirtualSolReserves` = 300,000,000 lamports, mainnet fork = 30,000,000,000 [VERIFIED: scripts/spike/results devnet.json and fork.json config rows]. Read-only devnet quote on stand-in Q `4Jw2pr67...` (2026-10-19): 0.0025 SOL buys 4.0% of a child curve, 0.025 SOL buys 30.2%, 0.25 SOL buys 85.4% and takes 478T of Q's 784T remaining [VERIFIED: devnet RPC read via core SDK, no sends]. Phase 1 used `g.initialVirtualSolReserves.divn(120)` on devnet for this reason [VERIFIED: scripts/spike/stages/launch.ts] | Minimum = `initialVirtualSolReserves / 120`, read from live Global: 0.25 SOL mainnet, 0.0025 SOL devnet. Presets scale the same way. UI copy uses the live value. Needs owner confirmation |
| 2 | UI-SPEC: paused copy "the Launch button unlocks automatically when the pool is live"; D-09 tx shape | `buildLaunch` buys Q with `buyExactIn` on Q's curve and the exit sell hard-codes `venue: "curve"` for both hops [VERIFIED: packages/core/src/launch.ts]. Phase 1 proved only a child create on a migrated Q (1,163 B) and multi_hop through the pool, not a full launch on a migrated Q | Choose one: (a) Phase 2 adds the migrated-Q path (pool buy for SOL to Q via `poolBuy` or a resolved multi_hop, exit hops from `resolveMultiHopRoute`), proven by a new fork spike stage; or (b) pause on "migrated" too, with honest copy, and carry the pool path to Phase 7. Default (b) for devnet, because with Contradiction 1 fixed the stand-in needs about 90 insta-burn launches to complete |
| 3 | UI-SPEC: Sentry "`sendDefaultPii: false`" | `sendDefaultPii` was deprecated in 10.57 and replaced by `dataCollection` in v11. An unset or empty `dataCollection` is more permissive than v10 defaults [CITED: blog.sentry.io/datacollection-control-panel; releases.sh note] | Set an explicit restrictive `dataCollection` (userInfo false, cookies false, httpBodies [], header and query deny lists) plus a `beforeSend` / `beforeBreadcrumb` base58 scrub |
| 4 | UI-SPEC: `pnpm dlx shadcn@latest init` | shadcn latest 4.22.1 is 1 day old. The CLI also installs the latest lucide-react (1.59.0, 2 days) and radix-ui (1.8.1, 7 days); all three fail D-14 [VERIFIED: npm view time] | `pnpm dlx shadcn@4.21.2 init`, then pin `lucide-react@1.52.0` and `radix-ui@1.6.7`. Or hand-copy the 4 tiny components and skip the CLI |
| 5 | UI-SPEC font `Big_Shoulders_Display` | Not in next@16.3.8 `font-data.json`. `Big Shoulders` exists with axes `opsz` 10-72 and `wght` [VERIFIED: next 16.3.8 tarball] | Use the UI-SPEC fallback: `Big_Shoulders({ axes: ["opsz"], subsets: ["latin"] })` (variable weight), CSS `font-weight: 800`, `font-optical-sizing: auto` |
| 6 | CONTEXT discretion: "store ground mint secrets encrypted (AES-256-GCM)" | Not needed. Seed-derived grind stores no secret | Store `(idx, pubkey)` only; the mint keypair is `derive(master, "mint", net, String(idx))` (Pattern 5) |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Phantom discovery, connect, disconnect, account change | Browser | - | Wallet Standard lives in the page; no server state before consent |
| Consent prompt and flag | Browser (localStorage check) | Web server (upsert `wallets` on Accept) | "Nothing sent before Accept" means the pre-check must be client-side |
| Form validation | Browser and Web server (same pure `core/rules.ts`) | Worker (re-checks lengths and URI) | Trust boundary is the server; client copy for UX |
| Image and metadata pinning | Web server (route handler, Pinata JWT) | - | Web already receives the file; the Pinata JWT is not a wallet secret (D-06) |
| Rate limiting prepare | Web server (per IP, per wallet) | Worker (global hourly cap) | Web sees client IPs; the worker bounds ops spend |
| Live fee config, quote, balance | Worker | Web server (proxy, cache) | Needs the pump SDK, which web must never import (D-15) |
| Vanity reservation, W derivation, lookup table, build, simulate | Worker | DB | Seed and ops key live only in the worker (D-06, FEE-10) |
| Signing | Browser (Phantom) then Worker (mint) | - | Sign order A (D-12) |
| Byte compare, exit check, send, settle | Worker | DB (state machine) | Enforcement point is the mint key |
| Launch status, token page, paused flag reads | Web server (DB reads) | Worker (Q-state check) | Plain DB reads; no chain library in web |
| Error capture | Web (client + server) and Worker | Sentry | OPS-01 |

## Standard Stack

All versions checked with `npm view <pkg> time --json` on 2026-10-19 against the D-14 cutoff (published on or before 2026-10-05) [VERIFIED: npm registry]. "Latest" is shown so the planner sees what was rejected.

### Core (new)
| Library | Pin | Published | Latest (age) | Purpose | Why |
|---------|-----|-----------|--------------|---------|-----|
| next | 16.3.8 | 2026-09-30 | 16.4.2 (4 d, fails) | Web app, route handlers | Same version agencybook runs in production with raw-.ts core and `transpilePackages` [VERIFIED: agencybook apps/web/package.json] |
| react, react-dom | 19.3.0 | 2026-09-09 | 19.3.1 (5 d, fails) | UI | Next 16 peer |
| @types/react, @types/react-dom | 19.3.0 | 2026-09-09 | same | Types | |
| @wallet-standard/app | 1.1.1 | 2026-06-03 | same | `getWallets()` discovery | agencybook proved it with Phantom 26.32.0 on devnet (arms A and B) [VERIFIED: agencybook 09-05-SUMMARY] |
| tailwindcss, @tailwindcss/postcss | 4.3.3 | 2026-07-16 | same | Styling, CSS-first `@theme` | AGENTS default |
| @sentry/nextjs | 11.4.0 | 2026-10-02 | 11.8.0 (4 d, fails) | Web errors | Peer `next ^16.0.0-0` [VERIFIED: npm view peerDependencies]; exports `./config` for `withSentryConfig` |
| @sentry/node | 11.4.0 | 2026-10-02 | 11.8.0 (fails) | Worker errors | agencybook worker runs 11.4.0 |
| drizzle-orm | 0.45.3 | 2026-09-21 | 0.45.4 (11 d, fails) | Typed queries | agencybook pattern |
| drizzle-kit | 0.31.11 | 2026-09-21 | same | Generate SQL migrations | agencybook pattern |
| postgres (postgres.js) | 3.4.9 | 2026-04-05 | same | Driver for both long-running services | agencybook pattern; Neon serverless driver is for edge/serverless and not needed on Railway |

### Supporting
| Library | Pin | Published | Purpose | When |
|---------|-----|-----------|---------|------|
| class-variance-authority | 0.7.1 | 2024-11-26 | Button variants | shadcn button |
| clsx | 2.1.1 | 2024-04-23 | `cn()` | shadcn util |
| tailwind-merge | 3.7.0 | 2026-09-12 | `cn()` | shadcn util |
| lucide-react | 1.52.0 | 2026-10-04 | Icons | 1.53+ all fail D-14 |
| radix-ui | 1.6.7 | 2026-07-24 | Slot (Button asChild), Label | 1.7.0 was published 2026-10-05T23:09Z, so it passes only after 2026-10-19T23:09Z; take 1.6.7 |
| server-only | 0.0.1 | 2022-09-03 | Build error if a server module reaches a client component | `apps/web/lib/db.ts`, `lib/worker.ts` |
| @playwright/test | 1.63.0 | 2026-09-04 | E2E with fake Phantom | 1.64.x fail D-14 |
| @axe-core/playwright | 4.13.0 | 2026-08-11 | UI-SPEC a11y gate | 4.14.0 fails |

Already installed and reused: `@pump-fun/pump-sdk` 4.1.0 (2026-10-13, D-14 exception), `@pump-fun/pump-swap-sdk` 2.1.0 (2026-10-07, exception), `@solana/web3.js` 1.99.0, `@solana/spl-token` 0.4.15, `bs58` 6.0.0, `bn.js` 5.2.5, `vitest` 4.1.11, `@biomejs/biome` 2.5.15, `typescript` 7.0.2, `@types/node` 24.19.1.

Not added (ponytail):
| Rejected | Why |
|----------|-----|
| `pinata` SDK 2.5.6 | Two `fetch` calls to one REST endpoint |
| `@neondatabase/serverless` 1.2.0 | Railway runs long-lived Node; postgres.js is enough |
| `zod` | A dozen length and regex checks in one pure module |
| Hono / Express in the worker | Four routes on `node:http` |
| `tw-animate-css` | UI-SPEC: CSS-only motion, no shadcn animated components used |
| `@solana/wallet-adapter-*`, `@solana/kit` in web | Wallet Standard bytes only; no Solana library in the browser (agencybook CHN-02) |
| `solana-keygen` in the Railway image | Node grinder is the same speed per thread; no Dockerfile needed |
| `tweetnacl` | `node:crypto` Ed25519 verify (agencybook `signatureOk`) |

**Installation (pinned, exact):**
```bash
pnpm --filter @bondr/web add next@16.3.8 react@19.3.0 react-dom@19.3.0 @wallet-standard/app@1.1.1 \
  @sentry/nextjs@11.4.0 class-variance-authority@0.7.1 clsx@2.1.1 tailwind-merge@3.7.0 \
  lucide-react@1.52.0 radix-ui@1.6.7 server-only@0.0.1
pnpm --filter @bondr/web add -D tailwindcss@4.3.3 @tailwindcss/postcss@4.3.3 @types/react@19.3.0 @types/react-dom@19.3.0
pnpm --filter @bondr/worker add @sentry/node@11.4.0
pnpm --filter @bondr/core add drizzle-orm@0.45.3 postgres@3.4.9
pnpm --filter @bondr/core add -D drizzle-kit@0.31.11
pnpm add -Dw @playwright/test@1.63.0 @axe-core/playwright@4.13.0
```

**Enforce D-14 mechanically (recommended):** set `minimumReleaseAge: 20160` (14 days, in minutes) in `pnpm-workspace.yaml`. Add `minimumReleaseAgeExclude: ["@pump-fun/pump-sdk@4.1.0", "@pump-fun/pump-swap-sdk@2.1.0"]`; version-specific excludes exist since pnpm 10.19 and the repo pins pnpm 10.34.6 [CITED: pnpm.io/settings/dependency-resolution]. Risk: pnpm may re-check locked entries, and transitive deps of the pump SDKs may be younger than 14 days. Try it in Wave 0; if install fails, keep 1440 and check versions by hand.

## Package Legitimacy Audit

slopcheck (installed at /opt/homebrew/bin/slopcheck) scanned a scratch package.json of the recommended set; no install was run.

| Package | Registry | Age at pin | Source Repo | Install scripts | slopcheck | Disposition |
|---------|----------|-----------|-------------|-----------------|-----------|-------------|
| next 16.3.8 | npm | 19 d | github.com/vercel/next.js | none | OK | Approved |
| react / react-dom 19.3.0 | npm | 40 d | github.com/react/react | none | OK | Approved |
| @wallet-standard/app 1.1.1 | npm | 4.5 mo | github.com/wallet-standard/wallet-standard | none | OK | Approved |
| tailwindcss / @tailwindcss/postcss 4.3.3 | npm | 3 mo | github.com/tailwindlabs/tailwindcss | none | OK | Approved |
| class-variance-authority 0.7.1 | npm | 23 mo | github.com/joe-bell/cva | none | OK | Approved |
| clsx 2.1.1 | npm | 2.5 y | github.com/lukeed/clsx | none | OK | Approved |
| tailwind-merge 3.7.0 | npm | 37 d | github.com/dcastil/tailwind-merge | none | OK | Approved |
| lucide-react 1.52.0 | npm | 15 d | github.com/lucide-icons/lucide | none | OK | Approved |
| radix-ui 1.6.7 | npm | 3 mo | github.com/radix-ui/primitives | none | OK | Approved |
| @sentry/nextjs, @sentry/node 11.4.0 | npm | 17 d | github.com/getsentry/sentry-javascript | none | OK | Approved |
| drizzle-orm 0.45.3, drizzle-kit 0.31.11 | npm | 28 d | github.com/drizzle-team/drizzle-orm | none | OK | Approved |
| postgres 3.4.9 | npm | 6.5 mo | github.com/porsager/postgres | none | OK | Approved |
| @playwright/test 1.63.0 | npm | 45 d | github.com/microsoft/playwright | none | OK | Approved |
| @axe-core/playwright 4.13.0 | npm | 2 mo | github.com/dequelabs/axe-core-npm | none | OK | Approved |
| server-only 0.0.1 | npm | 4 y | none listed (Vercel's Next.js marker package) | none | OK (info: NO_REPO) | Approved; it is the package Next.js docs name |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
Browser (/launch, client island)
  |  getWallets() -> Phantom (Wallet Standard)  [connect / disconnect / events.change]
  |  Accept consent -------------------------------> POST /api/consent ----> DB wallets (upsert)
  |  step 2 typing (debounced) --------------------> POST /api/quote --------> worker POST /quote
  |  status poll every 10 s on /launch ------------> GET  /api/status -------> DB settings + worker GET /status (Q state, fees, min)
  |
  |  "Sign in Phantom"
  |   row 1: multipart image + fields -------------> POST /api/launch/pin
  |                                                    rate limit (IP, wallet) -> rules.ts -> consent row?
  |                                                    Pinata: image -> cid1; JSON{image: ipfs.io/ipfs/cid1} -> cid2
  |                                                    <- { uri: https://ipfs.io/ipfs/cid2, cid }
  |   row 2: { wallet, fields, uri, solIn, exit } -> POST /api/launch/prepare -> worker POST /prepare (Bearer WORKER_TOKEN, private network)
  |                                                    paused? (DB flag, Q complete-no-pool, Q migrated)
  |                                                    reserve vanity (wallet's live reservation or next free idx) -> mint = derive(seed,"mint",net,idx)
  |                                                    W = derive(seed,"w",net,mint); balance check
  |                                                    table for (mint, dev): reuse, else createTable(ops) [2 txs, about 5 s]
  |                                                    buildLaunch -> compileToV0Message(table) -> checkMessage allowlist -> exitPresent -> size <= 1232
  |                                                    simulateTransaction(sigVerify false) -> costs, solBack; map 6107 -> paused
  |                                                    DB launches: state 'prepared', message bytes, blockhash, lastValidBlockHeight
  |                                                    <- { launchId, tx (base64 wire, 2 empty sig slots), mint, bytes, signBy, preview }
  |   row 3: Phantom solana:signTransaction(chain solana:devnet) -> signed wire
  |   row 4: { launchId, signed } ----------------> POST /api/launch/submit -> worker POST /submit
  |                                                    UPDATE ... SET state='signed' WHERE id AND state='prepared' (idempotency)
  |                                                    paused? blockhash valid? sameMessage + deployer sig + exitPresent
  |                                                    add mint signature -> sendRawTransaction (preflight on) -> state 'sent', sig
  |                                                    background settle: landed | failed | unknown (D-16) -> facts from meta
  |   row 5: poll GET /api/launch/{id} every 1 s --> DB launches (web reads)
  v
Step 5 Live -> /coin/[mint] (server page, DB read; 404 for unknown mint)

Worker background: vanity grinder (worker_threads, refill below threshold), resume 'signed'/'sent'/'unknown' launches on boot
```

### Recommended Project Structure
```
apps/
  web/                      # Next.js 16 (App Router), no Solana library in the browser
    app/                    # layout (fonts, header, footer, wallet provider), launch/, coin/[mint]/, terms/, api/
    components/             # wallet control, consent dialog, launch steps, receipt, proof stamp, CA row
    lib/                    # db.ts (server-only re-export of core/db), worker.ts (server-only fetch with token), pinata.ts, rate-limit.ts
    e2e/                    # Playwright specs (*.e2e.ts, so Vitest never picks them up)
    instrumentation.ts, instrumentation-client.ts, sentry.server.config.ts, next.config.ts
  worker/
    src/                    # main.ts, http.ts, prepare.ts, submit.ts, settle.ts, vanity.ts, grind.ts, status.ts, sentry.ts
packages/
  core/
    src/                    # existing chain modules + rules.ts (pure), cosign.ts, db/schema.ts, db/client.ts, db/migrate.ts
    migrations/             # drizzle-kit generated SQL, committed
    README.md               # D-15: raw .ts exports, type stripping, transpilePackages, never pnpm deploy/injected
scripts/
  check-client-bundle.sh    # port of agencybook gate
  vanity-grind.ts           # optional: pre-fill the pool from the Mac (stores idx + pubkey only)
```

### Pattern 1: Web never touches the chain
**What:** Web imports only `@bondr/core/math`, `@bondr/core/rules` and `@bondr/core/db*`. Anything that needs the pump SDK, web3.js, the seed or the Helius key goes through a worker route. Phantom gets raw bytes (base64 to `Uint8Array`), never a web3.js object.
**Enforcement (three layers):**
1. Biome override for `apps/web/**`: `noRestrictedImports` with patterns blocking `@bondr/core/*` except the allowlist, plus `@solana/*`, `@pump-fun/*` and `bn.js` (Code Example 6). An allowlist fails closed when a new chain module is added to core.
2. `scripts/check-client-bundle.sh` (agencybook port) greps `.next/static` for program ids and web3.js constants after `next build`.
3. Web boot guard in `instrumentation.ts`: exit if `MASTER_SEED` (or any `*_SEED`) is set in web's env (agencybook "web refuses to start with it").

### Pattern 2: Phantom through Wallet Standard (agencybook LaunchIsland, proven)
- `getWallets().get()` filtered to `w.name === "Phantom"`, with `solana:signTransaction` that lists version `0`, `w.chains.includes("solana:devnet")` and `standard:connect`. Re-filter on `register` / `unregister` events, because Phantom may register after first render. Show "Phantom not installed" only after a short grace period (for example 600 ms) [VERIFIED: agencybook apps/web/app/components/LaunchIsland.tsx].
- Connect: `standard:connect`. On load, try `connect({ silent: true })` to restore a trusted session without a popup.
- Account change: subscribe `standard:events` `on("change", ({ accounts }) => ...)`. Phantom's own docs describe `accountChanged` on `window.phantom.solana` [CITED: docs.phantom.com/solana/establishing-a-connection]. That Phantom's Wallet Standard object emits `change` is [ASSUMED]: verify in Wave 0, and fall back to `window.phantom?.solana?.on("accountChanged")`.
- Sign: `solana:signTransaction({ account, transaction: bytes, chain: "solana:devnet" })`. Never `signAndSendTransaction`: the server must add the mint signature after Phantom.
- Mobile without the extension: `https://phantom.com/ul/browse/${encodeURIComponent(location.href)}?ref=${encodeURIComponent(location.origin)}` [CITED: docs.phantom.com/phantom-deeplinks/other-methods/browse] (agencybook used the older phantom.app host).
- Rejection detection: `code === 4001` or `/reject|cancel|declin|denied/i` (agencybook).

### Pattern 3: Sign order A and byte compare (agencybook, production)
- Prepare stores `message.serialize()` (the exact bytes) and returns the wire with 2 empty signature slots (payer = dev at index 0, mint at index 1).
- Submit: `sameMessage(stored, wire, 2)`, then `signatureOk(stored, slot(wire, 0), dev)`, then `exitPresent`, then `addSignature(wire, mintKeypair)`, then `signatureOk(stored, slot(wire, 1), mint)`. Any failure means refuse with nothing sent (Code Example 2).
- Phantom does not touch the bytes when ComputeBudget price and limit instructions are present: "The transaction(s) do not have existing priority fee instructions" is one of its 3 conditions for adding fees [CITED: docs.phantom.com/developer-powertools/solana-priority-fees]. Core `budget()` already emits price then limit with a non-zero price (agencybook D-194 ordering).
- Phantom's multi-signer guidance is this exact order: "Phantom signs first, and the other signers add their signatures", and the dapp should "submit ... with preflight enabled" [CITED: docs.phantom.com/developer-powertools/domain-and-transaction-warnings].
- Expect the warning "This domain is new or has not been reviewed yet" on the Railway domain. agencybook's real-extension probe saw no unknown-signer warning in either arm [VERIFIED: agencybook 09-05-SUMMARY].
- Lighthouse guards: Phantom "may" add assertion instructions [CITED: docs.phantom.com/developer-powertools/lighthouse]. A third-party observation says devnet never modified a tx and mainnet left a wallet-plus-new-mint create untouched [CITED via agencybook 09-RESEARCH: github.com/rebeltrenches/signal-platform PR #43, #60]. The byte compare fails closed either way; mainnet is Phase 7's check.

### Pattern 4: Prepare is idempotent per reservation and reuses the table
- The reservation is keyed by wallet and lasts 10 minutes (the UI copy promises 10). A new prepare by the same wallet inside the window reuses the same mint, W and lookup table. Only the blockhash and the amounts change. "Try again" after a Phantom rejection then takes about 1 s, not about 5 s.
- Put the union of burn and sell keys in one table, so a changed exit does not need a new table. Table keys depend only on the mint, W, dev and Q state, not on amounts, name or URI (`tableKeys` excludes signers and program ids) [VERIFIED: packages/core/src/alt.ts].
- Measured on devnet: table tx 1 to the launch landing took 23-25 slots, 5-6 s. That covers both table txs, warm-up, two 1.1 s send pacings and the launch confirm [VERIFIED: devnet getTransaction slots and blockTime for launch.table.burn to launch.burn and launch.table.sell to launch.sell].
- Run the Pinata pin (web, row 1) before prepare. The URI is instruction data, not an account key, so the worker could create the table in parallel; that optimization is optional.
- `freshSlot` keeps per-process memory of the last finalized slot per authority. One worker process is fine (existing `ponytail:` note).
- Simulate before returning: `simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false, accounts: { addresses: [dev], encoding: "base64" } })`. Phantom asks dapps to "simulate the transaction with `sigVerify: false`" first [CITED: Phantom warnings page]. The simulation catches 6107 (Q complete) and low balance before Phantom opens, and gives exact `createCost` and `solBack` (agencybook build.ts did the same).

### Pattern 5: Seed-derived vanity pool
- `mint(idx) = derive(master, "mint", net, String(idx))` (add `"mint"` to `Role` in core `keys.ts`). Store `(idx bigint pk, pubkey text unique, reserved_by, reserved_until, used_at)`. No secret at rest, no extra env key.
- Suffix test without base58-encoding each key: the last 4 base58 digits are `n mod 58^4`. `"bndr"` = 6,787,325. On 20,000 random keys this matched `bs58.encode(k).slice(-4)` with 0 mismatches [VERIFIED: local test with core's bs58 6.0.0].
- Grind with `worker_threads`: thread k tries idx = k, k+T, k+2T, ... Store `next_idx` so restarts continue. Store only hits.
- Pool target 20, refill below 10, Sentry warning below 3. One thread at low duty: about 5.5 min per key on an M4 thread, so a Railway vCPU probably needs 6-12 min per key [ASSUMED for Railway CPU speed]. 20 keys take about 2-4 vCPU-hours, cents of usage.
- `scripts/vanity-grind.ts` can pre-fill from the Mac with the same devnet seed (`~/.bondr-spike/devnet/master.seed`) and insert only `(idx, pubkey)`.
- Reserve with one statement (Code Example 8). Release on expiry only when the launch is `prepared` or `failed`. Never release while `signed`, `sent` or `unknown`.

### Pattern 6: Consent without leaking the address first
- After connect, the client checks `localStorage["bondr:consent:" + address]`. If it is missing, the dialog opens. Nothing is sent until Accept.
- Accept POSTs `{ wallet }` (body, not URL), which upserts `wallets(address, consented_at, terms_version)`, then sets the localStorage flag. A new device prompts again; Accept is an idempotent upsert.
- Worker prepare refuses a wallet with no `wallets` row (`consent_required`).

### Pattern 7: One pure rules module
`packages/core/src/rules.ts` (no imports beyond the language) serves the browser, the web server and the worker:
- name: trimmed, at least 1, at most 32 UTF-8 bytes (agencybook counted bytes and told users emoji and accents cost more) [VERIFIED: agencybook packages/core/src/launch/rules.ts]
- symbol: trimmed, uppercased, `/^[A-Z0-9]{1,13}$/`
- description: at most 500; links: https only; X host `x.com` or `twitter.com`, Telegram `t.me`, website any http(s); add `https://` when missing; refuse other schemes
- image: magic bytes PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `47 49 46 38`, WEBP `RIFF....WEBP`; at most 4 MB; no SVG
- dev buy: `minLamports(initialVirtualSolReserves) = reserves / 120n`; this is the only place the number lives
- URI: at most 200 chars, prefix `https://ipfs.io/ipfs/`

### Pattern 8: Launch state machine and LAUNCH-05 timing
- States: `prepared -> signed -> sent -> landed | failed | unknown`, with `unknown -> landed | failed` after a history recheck. A DB `CHECK` constraint holds the list; each transition is `UPDATE ... WHERE id = $1 AND state = $expected RETURNING`, so a double submit is a no-op that returns the current state.
- Persist the signed wire before sending. A restart with `signed` re-sends while the blockhash is valid: same signature, so Solana dedupes it.
- Settle in the background (submit returns `{ sig }` right after `sendRawTransaction`). Mark `landed` as soon as `getSignatureStatuses` shows `confirmed` with `err: null`, then fill facts (dev child balance after, burn amount or SOL back, from meta and `events.ts`) a moment later. With a 1 s client poll, the success screen shows about 1-2 s after confirmation.
- D-16: never resend an `unknown`. After `lastValidBlockHeight` has passed, recheck with `searchTransactionHistory: true` (for example 3 times, 10 s apart). If it is still unseen, mark `failed` (expired) and release the reservation.
- Send path: core `sendTx` signs with Keypairs. Extract `sendRaw(conn, wire, sig, bytes, bh)` from it, so `settle` and `thrown` are reused (a small core refactor with the existing `send.test.ts` as the guard).

### Pattern 9: Paused state
- Kill switch: `settings(id=1, launches_enabled bool)`. The owner flips it with SQL in the Neon console until Phase 6.
- Q state, checked on demand and cached 5 s in the worker: `curve.complete` false means ok. `complete` with the canonical pool account (`canonicalPumpPoolPdaWithQuote(Q, NATIVE_MINT)`) missing means `awaiting_migration`. `complete` with the pool present means `migrated`, which pauses too unless Contradiction 2 option (a) is built.
- Both prepare and submit enforce the pause server-side; the UI only reflects it. On devnet the keeper migrated about 10 slots after completion [VERIFIED: devnet row aux.child.create.migratedQ notes], so the "awaiting" window is seconds.
- Web polls `/api/status` every 10 s while `/launch` is open (the UI-SPEC says "polls"). No background loop in the worker, which keeps Neon able to scale to zero.

### Pattern 10: Pinata
- `POST https://uploads.pinata.cloud/v3/files`, `multipart/form-data`, `file` + `network=public`, header `Authorization: Bearer <JWT>`; response `data.cid` [CITED: docs.pinata.cloud/files/uploading-files]. Only `pinata_jwt` is needed; the api key and secret are legacy.
- Metadata JSON (agencybook shape): `{ name, symbol, description, image, showName: true, createdOn, twitter?, telegram?, website? }`.
- On-chain URI and `image`: `https://ipfs.io/ipfs/<cid>` (21 + 59 = 80 chars). It is gateway-neutral, so the coin survives a Pinata account change, and explorer and wallet fetches do not count against the free plan's 10K gateway requests. That pump.fun uses the same convention is [ASSUMED]. Render images in BONDR from the owner's dedicated gateway `https://<name>.mypinata.cloud/ipfs/<cid>` through `next/image`. A dedicated gateway "will only be able to fetch the files that are pinned to your account" by default [CITED: docs.pinata.cloud/gateways/retrieving-files].
- Pin at sign time (row 1), once per launch row; reuse the CID on retries. Free plan: 500 files, 1 GB, 10K gateway requests [CITED: pinata.cloud/pricing]. That is about 250 launches including abandoned ones; flag it for Phase 3.

### Pattern 11: Sentry on both services
- Web: `instrumentation-client.ts` (Sentry.init plus `onRouterTransitionStart`), `sentry.server.config.ts`, `instrumentation.ts` (`register()` imports the node config, plus `export const onRequestError = Sentry.captureRequestError`), and `withSentryConfig` from `@sentry/nextjs/config` [CITED: docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup]. No edge config: no edge runtime is used. Skip source-map upload (`authToken` unset) until Phase 7.
- Worker: port agencybook `apps/worker/src/sentry.ts` (no-op without `SENTRY_DSN`, `attachStacktrace: false`, `onUnhandledRejectionIntegration({ mode: "strict" })`).
- Privacy (consent list item 3 is a promise): explicit restrictive `dataCollection`, no tracing, no replay, plus `beforeSend` and `beforeBreadcrumb` that stringify, replace `/[1-9A-HJ-NP-Za-km-z]{32,44}/g` with `[addr]`, and parse back (agencybook `scrubEvent` pattern). This also scrubs mints and table addresses, which is acceptable.

### Pattern 12: Worker HTTP signer on Railway private networking
- `node:http` server on `process.env.PORT` (set `PORT=8080` on the worker), with no host argument, so Node binds dual-stack `::`. Internal DNS is `<service>.railway.internal`; environments created after 2025-10-16 resolve to IPv4 and IPv6; private networking is "only available at runtime, not during the build phase" [CITED: docs.railway.com/networking/private-networking/how-it-works].
- Web variable: `WORKER_URL=http://${{worker.RAILWAY_PRIVATE_DOMAIN}}:${{worker.PORT}}` [CITED: docs.railway.com/reference/variables for `RAILWAY_PRIVATE_DOMAIN` and `${{service.VAR}}`]. Never generate a public domain for the worker.
- Auth: `authorization: Bearer <WORKER_TOKEN>` (32 random bytes, hex), compared with `timingSafeEqual` after a length check. JSON body cap 16 KB.
- Routes: `GET /healthz`, `GET /status`, `POST /quote`, `POST /prepare`, `POST /submit`. Web reads launch status from the DB, so the worker needs no status route.
- Concurrency: one prepare at a time (a promise-chain mutex), because Helius free is 10 RPS and 1 send/s [CITED: helius.dev/pricing] and `pace()` is process-wide. `ponytail:` single-flight; per-wallet queues if launches get busy.

### Anti-Patterns to Avoid
- **Re-serializing the signed tx to compare:** compare the raw message slice of the returned wire (agencybook Pattern 1). `VersionedTransaction.deserialize(...).message.serialize()` can hide differences.
- **`signAndSendTransaction`:** Phantom would send without the mint signature (it fails) or may add Lighthouse instructions.
- **Trusting the client's exit choice at submit:** the exit comes from the stored launch row, never from the submit body.
- **Releasing a reservation on timeout while `sent` or `unknown`:** the tx could still land and the next dev would get a used mint.
- **Hardcoding 1.5%, 0.95% or 0.25 SOL anywhere:** read fees through SDK `computeFeesBps` and the minimum from Global.
- **Rendering the pump program id in a client component:** the bundle gate greps for it. The footer's `6EF8...F6P` must be in a server component.
- **Running `pnpm deploy` or an injected install for the worker:** Node will not strip types under `node_modules`. The worker must run from the workspace checkout, so `@bondr/core` resolves through the symlink to `packages/core/src`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fee rates for a BONDR-quoted curve | exotic/flat schedule logic | SDK `computeFeesBps({ global, feeConfig, mintSupply, virtualQuoteReserves, virtualTokenReserves, quoteMint: Q, creatorFeeBps })` [VERIFIED: pump-sdk 4.1.0 index.d.ts] | Handles exotic-unset-means-flat and the configurable override exactly as the program does |
| Tokens out for a dev buy | curve math | existing `amounts()` in core `launch.ts` (export it) | Already proven on both nets |
| SOL back on insta sell, create cost | curve or rent arithmetic | `simulateTransaction` with `accounts` at prepare (Phase 1 A7 proved accounts-option sims) | Exact. Before prepare, show "about" from fee-only math (Open Question 3) |
| Ed25519 verify | tweetnacl | `node:crypto` `verify(null, msg, jwkKey, sig)` (agencybook `signatureOk`) | Stdlib |
| Lookup table lifecycle | new table code | core `createTable` / `tableKeys` / `warm` | Proven, handles slot collisions |
| Send and status | new send loop | core `sendTx` internals (`settle`, `thrown`, `unseen`) via a `sendRaw` extraction | D-16 semantics already encoded and tested |
| Wallet discovery | custom injection probing | `@wallet-standard/app` | Proven with Phantom |
| Program allowlist on sign | new check | core `checkMessage` | Same allowlist as Phase 1 |
| Event decode for facts | log parsing | core `events.ts` | Logs get truncated (comment in events.ts) |
| Migrations | hand SQL runner | drizzle-kit generate + `migrate()` under an advisory lock (agencybook `migrate.ts`) | Proven |

**Key insight:** almost everything chain-related already exists in `packages/core` or agencybook with evidence. New code is glue, state and UI. The planner should budget for UI and integration, not for chain research.

## Common Pitfalls

### Pitfall 1: Devnet curves are 100x cheaper
**What goes wrong:** A 0.25 SOL dev buy nearly completes the child curve (85%) and takes 61% of the stand-in's remaining supply.
**How to avoid:** Minimum = `initialVirtualSolReserves / 120` from live Global (Contradiction 1).
**Warning signs:** Bond progress near 100% right after launch; the stand-in completes after a couple of launches.

### Pitfall 2: Launch builder assumes Q is on its curve
**What goes wrong:** After the stand-in migrates, `buyExactIn` on Q's curve and the `curve,curve` exit hops fail.
**How to avoid:** Pause on `migrated` (default) or build and fork-prove the pool path (Contradiction 2).

### Pitfall 3: Phantom changes bytes, or the user waits too long
**What goes wrong:** The byte compare fails (mainnet Lighthouse) or the blockhash expires (about 60-90 s).
**How to avoid:** Keep price-then-limit ComputeBudget with a non-zero price. Return `signBy` from `(lastValidBlockHeight - height) * 0.4 s`, capped at 60 (agencybook). Re-prepare with the same reservation ("Build again").

### Pitfall 4: Headless Chromium breaks Phantom's simulation
**What goes wrong:** With the default headless user agent, api.phantom.app answered 403, and the prompt said "Failed to simulate" with only "Confirm (unsafe)" [VERIFIED: agencybook 09-05-SUMMARY].
**How to avoid:** CI and e2e use the fake wallet (Validation). A real-extension run uses a normal Chrome user agent and is headed.

### Pitfall 5: Prepare spam drains ops
**What goes wrong:** Each new reservation costs about 0.0052-0.006 SOL of table rent on devnet [VERIFIED: PROJECT.md item 2] and a Pinata file.
**How to avoid:** Per-IP and per-wallet limits in web (agencybook `rate-limit.ts` fixed window, for example 5 per 10 min). Worker global cap (for example 30 new tables per hour, from a DB count). Check the dev's balance covers dev buy plus about 0.012 SOL before creating a table. Reuse tables per reservation. Alert below an ops floor. `ponytail:` in-memory per-instance limiter while web is one replica.

### Pitfall 6: Neon free tier never sleeps
**What goes wrong:** A worker loop that queries the DB every few seconds keeps compute on: 0.25 CU x 730 h = 182 CU-h, against 100 CU-h free [CITED: neon.com/pricing]. That is about $19/month on Launch at $0.106/CU-h.
**How to avoid:** No periodic DB polling in the worker. Pause checks and caches are on demand. Scale-to-zero triggers after "no active queries for 5 minutes", so idle pooled connections are fine; set postgres.js `idle_timeout`. Advisory locks are lost on suspend, which matters for a Phase 5 leader lock, not Phase 2.

### Pitfall 7: Vitest picks up Playwright specs
**What goes wrong:** The root `vitest run` includes `**/*.spec.ts`.
**How to avoid:** Name e2e files `*.e2e.ts` and run them with `playwright test`, or add a Vitest exclude.

### Pitfall 8: Biome on Tailwind v4 CSS
**What goes wrong:** Biome's CSS parser rejects `@theme`, `@custom-variant` and similar directives.
**How to avoid:** `"css": { "parser": { "tailwindDirectives": true } }` (exists in Biome 2.5.15 schema) [VERIFIED: node_modules/@biomejs/biome/configuration_schema.json].

### Pitfall 9: Env name mismatch
**What goes wrong:** Core reads `process.env.helius_api_key` (lowercase), and `.env` holds `pinata_jwt` lowercase. Railway names are case-sensitive.
**How to avoid:** Keep the existing lowercase names for the three keys already in `.env`, or rename them in one commit with `net.ts`. `.env.example` lists every name.

### Pitfall 10: Railway variables and secrets on argv
**What goes wrong:** A multi-name set corrupted a value (agencybook), and secrets end up in shell history.
**How to avoid:** One name per call; secrets through stdin: `printf %s "$V" | railway variable set MASTER_SEED --stdin --service worker --skip-deploys` [VERIFIED: railway 5.70.0 `variable set --help`].

### Pitfall 11: Next/font axes
**What goes wrong:** `Big_Shoulders_Display` does not exist, and axes need the variable weight.
**How to avoid:** `Big_Shoulders({ subsets: ["latin"], axes: ["opsz"], display: "swap", variable: "--font-big-shoulders" })` and `Martian_Mono({ axes: ["wdth"], ... })`; set weight 800 in CSS. Visual check against the mockup screenshots.

### Pitfall 12: TypeScript 7 with Next 16
**What goes wrong:** If Next's build-time type check cannot use the TS 7 package, `next build` fails.
**How to avoid:** agencybook runs next 16.3.8 with typescript 7.0.2 in production, with typecheck as `next typegen && tsc -p apps/web` [VERIFIED: agencybook package.json]. If `next build` complains, set `typescript.ignoreBuildErrors: true` and rely on the separate `tsc`.

## Code Examples

### 1. Phantom via Wallet Standard (trimmed from agencybook LaunchIsland.tsx)
```typescript
"use client";
import { getWallets } from "@wallet-standard/app";
type Account = { address: string; publicKey: Uint8Array; chains: readonly string[] };
type SignFeature = {
  supportedTransactionVersions: readonly ("legacy" | 0)[];
  signTransaction(...i: { account: Account; transaction: Uint8Array; chain?: string }[]):
    Promise<readonly { signedTransaction: Uint8Array }[]>;
};
type W = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
const feature = <T,>(w: W, n: `${string}:${string}`) => w.features[n] as T | undefined;
export const isPhantom = (w: W, chain: string): boolean => {
  const s = feature<SignFeature>(w, "solana:signTransaction");
  return w.name === "Phantom" && !!s && s.supportedTransactionVersions.includes(0) &&
    w.chains.includes(chain as `${string}:${string}`) && !!w.features["standard:connect"];
};
// sign: const [out] = await feature<SignFeature>(w, "solana:signTransaction")!.signTransaction(
//   { account, transaction: unb64(prepared.tx), chain: "solana:devnet" });
```

### 2. Co-sign check (port of agencybook sign.ts and completeLaunch)
```typescript
// Source: /Users/uzi/agencybook-phase-15/packages/core/src/launch/sign.ts, build.ts completeLaunch
import { createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";
const SIG = 64;
export function sameMessage(stored: Uint8Array, wire: Uint8Array, signers: number): boolean {
  if (wire[0] !== signers || wire.length !== 1 + SIG * signers + stored.length) return false;
  return Buffer.from(wire.subarray(1 + SIG * signers)).equals(stored);
}
export const slot = (wire: Uint8Array, i: number) => wire.subarray(1 + SIG * i, 1 + SIG * (i + 1));
export function signatureOk(message: Uint8Array, sig: Uint8Array, signer: string): boolean {
  const raw = bs58.decode(signer);
  if (raw.length !== 32 || sig.length !== SIG) return false;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") }, format: "jwk" });
  return verify(null, message, key, sig);
}
// completeLaunch: sameMessage -> signatureOk(slot 0, dev) -> exitPresent(message) -> tx.sign([mint]) -> signatureOk(slot 1, mint)
```

### 3. Seed-derived vanity grind (benchmarked: 33,934 keys/s/thread on M4)
```typescript
// One worker_threads thread. PKCS8 prefix + 32-byte seed gives the same key as Keypair.fromSeed (RFC 8032);
// unit-test that equality. The last 4 base58 digits are n mod 58^4, so no per-key base58 encode.
import { createHmac, createPrivateKey, createPublicKey } from "node:crypto";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const M = 58 ** 4;
const BNDR = 6_787_325; // [..."bndr"].reduce((a, c) => a * 58 + ALPHABET.indexOf(c), 0)
export function isBndr(master: Buffer, net: string, idx: number): string | null {
  const seed = createHmac("sha256", master).update(`mint:${net}:${idx}`).digest(); // same input as keys.ts derive
  const pub = createPublicKey(createPrivateKey({ key: Buffer.concat([PKCS8, seed]), format: "der", type: "pkcs8" }))
    .export({ format: "der", type: "spki" }).subarray(12);
  let r = 0;
  for (const b of pub) r = (r * 256 + b) % M;
  return r === BNDR ? pub.toString("base64") : null; // caller bs58-encodes the hit
}
```

### 4. Worker auth guard
```typescript
import { timingSafeEqual } from "node:crypto";
const TOKEN = Buffer.from(process.env.WORKER_TOKEN ?? "");
export function authorized(header: string | undefined): boolean {
  const got = Buffer.from(header?.replace(/^Bearer /, "") ?? "");
  return TOKEN.length >= 32 && got.length === TOKEN.length && timingSafeEqual(got, TOKEN);
}
```

### 5. Sentry (web server and worker share the options)
```typescript
// v11: sendDefaultPii is gone; spell out the restrictive dataCollection (blog.sentry.io/datacollection-control-panel)
const ADDR = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
export const scrub = <T>(e: T): T => JSON.parse(JSON.stringify(e).replace(ADDR, "[addr]"));
export const sentryOptions = {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? "local",
  dataCollection: {
    userInfo: false, cookies: false, httpBodies: [],
    httpHeaders: { request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] }, response: false },
    urlQueryParams: false, databaseQueryData: false,
  },
  beforeSend: scrub, beforeBreadcrumb: scrub,
};
// Exact dataCollection key shapes: check against @sentry/core 11.4.0 types in Wave 0 (MEDIUM confidence).
```

### 6. Biome override for apps/web (fails closed for new core modules)
```json
{
  "css": { "parser": { "tailwindDirectives": true } },
  "overrides": [{
    "includes": ["apps/web/**"],
    "linter": { "rules": { "style": { "noRestrictedImports": { "level": "error", "options": {
      "patterns": [
        { "group": ["@bondr/core/*", "!@bondr/core/math", "!@bondr/core/rules", "!@bondr/core/db/*"],
          "message": "D-15: web imports only pure core modules; chain work goes through the worker." },
        { "group": ["@solana/*", "@pump-fun/*", "bn.js"], "message": "D-15: no Solana library in web." }
      ] } } } } }
  }]
}
```

### 7. next.config.ts
```typescript
import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@bondr/core"], // raw .ts exports (D-15)
  poweredByHeader: false,
  images: { remotePatterns: [{ protocol: "https", hostname: process.env.PINATA_GATEWAY ?? "" }] },
};
export default withSentryConfig(config, { silent: true });
```

### 8. Reserve a vanity mint (one statement, Postgres)
```sql
UPDATE vanity_mints SET reserved_by = $1, reserved_until = now() + interval '10 minutes'
WHERE idx = (SELECT idx FROM vanity_mints
             WHERE used_at IS NULL AND (reserved_until IS NULL OR reserved_until < now())
             ORDER BY idx LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING idx, pubkey;
```
Run it only after checking the wallet has no live reservation. Mark `used_at` when the launch lands.

### 9. Minimal schema (Drizzle, `packages/core/src/db/schema.ts`)
```typescript
import { bigint, boolean, customType, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const wallets = pgTable("wallets", {
  address: text().primaryKey(), consentedAt: timestamp({ withTimezone: true }).notNull(), termsVersion: text().notNull(),
});
export const settings = pgTable("settings", { id: integer().primaryKey(), launchesEnabled: boolean().notNull().default(true) });
export const vanityMints = pgTable("vanity_mints", {
  idx: bigint({ mode: "bigint" }).primaryKey(), pubkey: text().notNull().unique(),
  reservedBy: text(), reservedUntil: timestamp({ withTimezone: true }), usedAt: timestamp({ withTimezone: true }),
});
export const launches = pgTable("launches", {
  id: text().primaryKey(), wallet: text().notNull().references(() => wallets.address),
  mint: text().notNull().references(() => vanityMints.pubkey), w: text().notNull(),
  state: text().notNull(), // CHECK in migration: prepared|signed|sent|landed|failed|unknown
  name: text().notNull(), symbol: text().notNull(), description: text(), links: jsonb(),
  imageCid: text(), uri: text().notNull(), solIn: bigint({ mode: "bigint" }).notNull(), exit: text().notNull(),
  lookupTable: text(), message: bytea(), blockhash: text(), lastValidBlockHeight: bigint({ mode: "bigint" }),
  signedTx: bytea(), signature: text().unique(), error: text(), facts: jsonb(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
// Add in SQL: CHECK (state IN (...)), CHECK (exit IN ('burn','sell')), unique index on (mint) WHERE state = 'landed'.
```
Use one database per environment (a Neon branch for staging), so no `net` column is needed. Migrations: `drizzle-kit generate` into `packages/core/migrations`, committed. `node packages/core/src/db/migrate.ts` runs as web's Railway pre-deploy command under `pg_advisory_lock` (agencybook).

### 10. Railway per-service config (`/apps/web/railway.json`, `/apps/worker/railway.json`)
```json
{ "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "RAILPACK", "buildCommand": "pnpm --filter @bondr/web build",
             "watchPatterns": ["apps/web/**", "packages/core/**", "pnpm-lock.yaml"] },
  "deploy": { "startCommand": "pnpm --filter @bondr/web start", "preDeployCommand": ["node packages/core/src/db/migrate.ts"],
              "healthcheckPath": "/api/health", "healthcheckTimeout": 120, "restartPolicyType": "ALWAYS" } }
```
Worker: no build command; start `node apps/worker/src/main.ts` (plain node so SIGTERM reaches it, agencybook), `healthcheckPath: "/healthz"`. Each service's config-file path is set to the absolute repo path [CITED via agencybook research: Railway config-as-code; HIGH there]. Railpack reads Node 24 from `engines` and pnpm from `packageManager` (agencybook deployed this way). Healthchecks run only at deploy time.

### 11. Fake Phantom for Playwright (registers through the Wallet Standard event protocol)
```typescript
// page.exposeFunction("bondrSign", (b64) => node-side Ed25519 sign of the message slice with a devnet test key)
await page.addInitScript(({ address, pubkey }) => {
  const account = { address, publicKey: new Uint8Array(pubkey), chains: ["solana:devnet"], features: [] };
  const listeners = new Set<(p: unknown) => void>();
  const wallet = {
    version: "1.0.0", name: "Phantom", icon: "data:image/svg+xml;base64,PHN2Zy8+", chains: ["solana:devnet"], accounts: [] as unknown[],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => { wallet.accounts = [account]; return { accounts: [account] }; } },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => { wallet.accounts = []; } },
      "standard:events": { version: "1.0.0", on: (_: string, cb: (p: unknown) => void) => (listeners.add(cb), () => listeners.delete(cb)) },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: [0],
        signTransaction: async ({ transaction }: { transaction: Uint8Array }) =>
          [{ signedTransaction: Uint8Array.from(atob(await (window as any).bondrSign(btoa(String.fromCharCode(...transaction)))), (c) => c.charCodeAt(0)) }] },
    },
  };
  const register = ({ register }: { register: (w: unknown) => void }) => register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e: any) => register(e.detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
}, { address, pubkey: [...pubkeyBytes] });
```
The register protocol is from the Wallet Standard spec [ASSUMED: event names `wallet-standard:register-wallet` and `wallet-standard:app-ready`; verify against @wallet-standard/app 1.1.1 source in Wave 0].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sentry `sendDefaultPii` | `dataCollection` options; v11 defaults collect more | Deprecated 10.57, removed in v11 | Explicit restrictive config required |
| Next.js `middleware.ts` | `proxy.ts` | Next 16 | Not needed in Phase 2 |
| `Big Shoulders Display` family | `Big Shoulders` with `opsz` axis | Google Fonts merge (in next 16.3.8 data) | Use variable font |
| `phantom.app/ul/browse` | `phantom.com/ul/browse` | Current Phantom docs | Use the new host |
| `window.phantom.solana` connect | Wallet Standard (`getWallets`) | Ecosystem standard; agencybook proven | No provider library |
| Pinata `pinFileToIPFS` + api key/secret | `uploads.pinata.cloud/v3/files` + JWT | Pinata v3 API | JWT only |

**Deprecated/outdated in this repo:** `SPIKE_*` env names stay for the spike; new app env names are separate. `prefundMint` is fork-only and not needed on devnet.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phantom's Wallet Standard object emits `standard:events` `change` on account switch | Pattern 2 | Account-switch handling silently misses; fallback `window.phantom.solana.on("accountChanged")` |
| A2 | Railway vCPU grinds at about 15-25k keys/s/thread (6-12 min per `bndr` key) | Pattern 5 | Slower pool refill; pre-fill from the Mac |
| A3 | pump.fun's own metadata URIs use `https://ipfs.io/ipfs/<cid>` | Pattern 10 | None functionally; only convention |
| A4 | Wallet Standard register events are `wallet-standard:register-wallet` / `wallet-standard:app-ready` | Code Example 11 | Fake wallet does not register; read @wallet-standard/app source |
| A5 | Node worker_threads run `.ts` entry files with type stripping on Node 24 | Pattern 5 | Use an inline JS string worker |
| A6 | Exact `dataCollection` key shapes in @sentry 11.4.0 match the blog post | Code Example 5 | Type errors; adjust to installed types |
| A7 | Phantom in-app mobile browser registers via Wallet Standard like the extension | Pattern 2 | Mobile connect fails; test on a phone at sign-off |
| A8 | pump create_v2 limits name and symbol by bytes as the UI rules assume | Pattern 7 | A valid-looking name fails on-chain; prepare simulation catches it |

## Open Questions (RESOLVED)

1. **Devnet dev-buy minimum (Contradiction 1).** What we know: 0.25 SOL on devnet takes 85% of the child curve. Recommendation: confirm `initialVirtualSolReserves / 120` with the owner before planning the step 2 UI; UI-SPEC copy "Minimum 0.25 SOL" becomes "Minimum {min} SOL".
   RESOLVED: D-17 (minimum = 0.25 SOL x live initial virtual quote reserves / 30 SOL).
2. **Migrated-BONDR launches (Contradiction 2).** Pause (default) or build the pool path now? This must exist by Phase 7 go-live, because BONDR mainnet will bond after about 85 SOL of buys.
   RESOLVED: D-18 (build the BONDR-pool route in Phase 2, proven on the fork in 02-03).
3. **Step 2 "You get back about {solBack}" before prepare.** Exact only after the prepare simulation. Default: a fee-only estimate `solIn x product of (1 - leg fee bps / 10000)` over 4 legs, labelled "about", replaced by the simulated value in step 4.
   RESOLVED: the fee-only estimate (estimateSolBack) in 02-06, replaced by the simulated value after prepare.
4. **Owner's Helius plan for staging.** Free means 10 RPS and 1 send/s; single-flight prepare covers a few friends.
   RESOLVED: single-flight prepare plus rate limits. The owner has not stated the plan; treat it as the free tier (10 rps, 1 send/s) until told otherwise.
5. **Pinata dedicated gateway domain.** Not in `.env`; the owner supplies it (or read it with the Pinata API using the JWT).
   RESOLVED: the public ipfs.io gateway is the fallback; the owner may supply a dedicated gateway later through the PINATA_GATEWAY env var.
6. **Staging seed.** Reusing the devnet spike seed (`~/.bondr-spike/devnet/master.seed`) keeps the funded ops wallet (2.917 SOL on 2026-10-19). That means piping the seed into Railway, which needs owner approval.
   RESOLVED: D-20 (staging reuses the devnet seed, copied into the worker through stdin after owner approval in 02-16).
7. **Sentry projects and DSNs** (D-05): the owner provides them or approves creation.
   RESOLVED: D-19 (Claude creates both Sentry projects with the owner-provided sentry_auth_token, 02-04).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | all | yes | 24.13.0 | - |
| pnpm | workspace | yes | 10.34.6 (corepack 0.34.5) | - |
| Railway CLI | deploy, variables | yes | 5.70.0 | Railway MCP |
| Railway MCP | deploy, logs | yes (deferred tools) | - | CLI |
| Neon MCP | create project (owner OK) | yes (deferred tools) | - | Neon console |
| solana-keygen | optional pool pre-fill | yes | 3.0.13 Agave | Node grinder (preferred) |
| playwright-cli | Tester screenshots | yes | - | @playwright/test |
| Playwright browsers | e2e | not confirmed | - | `pnpm exec playwright install chromium` |
| gh | PR | yes | 2.102.0 | - |
| Helius API key | worker RPC | yes (name in `.env`) | plan unknown | public devnet RPC (rate limited) |
| Pinata JWT | pinning | yes (name in `.env`) | - | - |
| Pinata gateway domain | image rendering | no | - | ipfs.io for rendering (slower) |
| Sentry DSNs | OPS-01 | no | - | Owner provides (D-05); code is a no-op without DSN |
| Devnet ops SOL | table rent | yes | 2.917 SOL (2026-10-19, STATE.md) | treasury top-up |
| Docker | - | no | - | Not needed (Railpack) |

**Missing dependencies with no fallback:** Sentry DSNs, and owner approval for Neon, Railway and secret transfer (human checkpoints).
**Missing dependencies with fallback:** Pinata gateway domain, Playwright browsers.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.11 (units, existing); @playwright/test 1.63.0 + @axe-core/playwright 4.13.0 (e2e, new) |
| Config file | none for Vitest (defaults); `playwright.config.ts` at root, Wave 0 |
| Quick run command | `pnpm test && pnpm lint && pnpm typecheck` |
| Full suite command | quick + `pnpm --filter @bondr/web build && sh scripts/check-client-bundle.sh && pnpm exec playwright test` |
| Devnet integration | `node --env-file=.env scripts/devnet-launch.ts` (gated, spends about 0.006 SOL of ops rent + 0.0025 SOL dev buy) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 | Connect, disconnect from /launch and /terms, account switch | e2e (fake Phantom) | `pnpm exec playwright test e2e/wallet.e2e.ts` | Wave 0 |
| PLAT-02 | No request carries the address before Accept; Accept stores the row; decline disconnects | e2e (request interception) | `playwright test e2e/consent.e2e.ts` | Wave 0 |
| PLAT-03 | /terms renders, linked from footer and consent | e2e | `playwright test e2e/terms.e2e.ts` | Wave 0 |
| PLAT-04 | Screenshots 390/768/1440, no horizontal scroll, axe 0 violations | e2e | `playwright test e2e/responsive.e2e.ts` | Wave 0 |
| LAUNCH-01 | Field rules (bytes, symbol charset, links, image magic) | unit | `pnpm vitest run packages/core/src/rules.test.ts` | Wave 0 |
| LAUNCH-02 | Button disabled until exit and min; min scales with reserves | unit + e2e | `vitest run rules.test.ts`; `playwright test e2e/launch-form.e2e.ts` | Wave 0 |
| LAUNCH-03 | One tx lands on devnet: `bndr` mint, creator W, dev holds 0 | integration (devnet) | `node --env-file=.env scripts/devnet-launch.ts` | Wave 0 |
| LAUNCH-03 | Max-length name, symbol and URI still fit 1232 B for both exits | integration (devnet, build only, no send) | same script with `--size-only` | Wave 0 |
| LAUNCH-04 | Tampered byte, wrong signer, missing signature, extra signature, missing exit: refused, nothing sent | unit + integration | `vitest run packages/core/src/cosign.test.ts`; devnet script `--tamper` | Wave 0 |
| LAUNCH-05 | Landed visible within 5 s of confirmation; CA copy; tx link | e2e on devnet with fake Phantom (local web + worker) | `playwright test e2e/launch-live.e2e.ts` | Wave 0 |
| LAUNCH-06 | Kill switch and Q-state pause: banner, button disabled, form fillable, server refuses | unit (`qState` pure decision) + e2e (settings flag) | `vitest run apps/worker/src/status.test.ts`; `playwright test e2e/paused.e2e.ts` | Wave 0 |
| LAUNCH-07 | Pin returns CID; URI at most 200 chars; JSON shape | unit (metadata builder) + integration (Pinata, gated) | `vitest run apps/web/lib/pinata.test.ts` | Wave 0 |
| FEE-10 | No chain lib or program id in client chunks; web refuses to boot with a seed; Biome blocks imports | static | `sh scripts/check-client-bundle.sh`; `pnpm lint` | Wave 0 |
| OPS-01 | A thrown test error reaches Sentry from both services; scrub removes addresses | unit (scrub) + manual (DSN) | `vitest run apps/worker/src/sentry.test.ts` | Wave 0 |
| (pool) | Derived key equals `Keypair.fromSeed`; mod suffix equals bs58 tail; reservation SQL | unit | `vitest run apps/worker/src/vanity.test.ts` | Wave 0 |
| (state) | Transition guards, unknown never resent before expiry | unit | `vitest run apps/worker/src/settle.test.ts` | Wave 0 |

Manual-only: one real Phantom launch on staging by the owner (records Phantom's warnings; the agencybook probe is the template), and the owner's review of the terms and consent copy.

### Sampling Rate
- **Per task commit:** `pnpm test && pnpm lint && pnpm typecheck`
- **Per wave merge:** full suite (web build, bundle gate, Playwright against local web + worker on devnet)
- **Phase gate:** full suite green, devnet integration script green, Playwright against the staging URL, then `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `pnpm-workspace.yaml`: add `apps/*`; try `minimumReleaseAge: 20160` with the pump SDK excludes
- [ ] `playwright.config.ts`, `e2e/fixtures/phantom.ts` (fake wallet), Chromium install
- [ ] `packages/core/src/rules.ts` + test; `cosign.ts` + test; `keys.ts` gains the `"mint"` role and `seedFromEnv`
- [ ] `scripts/check-client-bundle.sh` with `--self-test`
- [ ] `scripts/devnet-launch.ts` (prepare -> sign with the sim dev key -> submit, plus `--tamper` and `--size-only`)
- [ ] Probe Phantom `standard:events` and the register protocol (A1, A4)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partly | No user accounts. The dev's Ed25519 signature authenticates the launch. Service-to-service uses a Bearer token + `timingSafeEqual` |
| V3 Session Management | no | No sessions or cookies (Phantom holds the connection) |
| V4 Access Control | yes | Worker not publicly routable; consent row required for prepare; launch row bound to its wallet; exit taken from the stored row |
| V5 Input Validation | yes | `core/rules.ts` on both sides; image magic bytes; https-only links; JSON body caps; URI length |
| V6 Cryptography | yes | `node:crypto` HMAC derivation (existing), Ed25519 verify, `randomBytes` for ids and token. Never hand-roll |
| V7 Errors and Logging | yes | `redact()` for the Helius key (existing); Sentry scrub; no wallet in URLs |
| V8 Data Protection | yes | Consent before storage; minimal columns; secrets only in worker env |
| V12 Files | yes | PNG/JPG/GIF/WEBP only, 4 MB cap, no SVG, re-served through `next/image` |
| V13 API | yes | Per-IP and per-wallet rate limits; Origin check on POST routes |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Signed message altered (exit removed, recipient swapped) | Tampering | Raw byte compare + `exitPresent` + program allowlist (`checkMessage`) before the mint signature |
| Submit replayed or raced | Tampering | `WHERE state='prepared'` transition; one signature per launch |
| Prepare spam drains ops rent or Pinata quota | DoS | Rate limits, balance pre-check, hourly cap, table reuse, ops floor alert |
| Seed or mint key reaches web | Info disclosure | Biome allowlist, client bundle gate, web boot guard, seed only in worker env via stdin |
| Phantom rewrites tx on mainnet | Tampering | Fail closed on byte mismatch (Phase 7 sign-only check) |
| Stored XSS via name, description or links | Tampering | React escaping, no `dangerouslySetInnerHTML` (Biome rule already on), https-only links with `rel="noopener"` |
| CSRF on consent and prepare | Spoofing | JSON-only POST + same-origin `Origin` check |
| Clickjacking the sign flow | Spoofing | `frame-ancestors 'none'` / `X-Frame-Options: DENY` (port agencybook headers) |
| Wallet addresses in Sentry | Info disclosure | `dataCollection` restrictive + base58 scrub (consent promise) |
| Mainnet by accident | Elevation | Worker exits on `SOLANA_NET=mainnet` without `ALLOW_MAINNET=1`; `Net` type has no mainnet yet |

## Risks, Ranked

1. **Devnet minimum (Contradiction 1).** If 0.25 SOL ships on devnet, staging launches nearly complete their own curves and the stand-in bonds within a couple of launches. Fix before planning the step 2 UI.
2. **Migrated-BONDR launch path missing (Contradiction 2).** Silent failures after migration if the UI unpauses; a Phase 7 blocker either way.
3. **Phantom byte stability and account events.** Devnet is proven by agencybook; `standard:events` support is assumed (A1); mainnet Lighthouse is unknown (Phase 7).
4. **Ops drain through prepare.** Each new reservation costs about 0.006 SOL of devnet rent; mitigated by the limits in Pitfall 5.
5. **Prepare latency.** About 5-6 s for a new table on devnet (measured), plus Pinata and simulation. Acceptable with the step 4 rows, and reuse makes retries about 1 s.
6. **Helius free tier 429s with several concurrent users.** Single-flight prepare; upgrade plan if staging gets busy.
7. **Sentry v11 defaults leak data if misconfigured** (Contradiction 3). One unit test on the scrub plus an explicit config.
8. **Neon free-tier compute hours** if anything polls the DB. Design avoids polling.
9. **Pinata free plan** (500 files, 10K gateway requests). Fine for Phase 2; revisit in Phase 3.
10. **Dependency freshness drift.** Every pin above is dated; a later install date may allow newer patches, and re-checking is cheap.

## Sources

### Primary (HIGH confidence)
- Codebase: packages/core/src (launch.ts, alt.ts, send.ts, keys.ts, net.ts, trade.ts, pump.ts, config.ts), scripts/spike/stages/launch.ts, create.ts, config.ts, scripts/spike/results/devnet.json and fork.json
- Devnet chain reads (public RPC, read-only, 2026-10-19): launch and table tx slots and times; dev lamport deltas; stand-in Q curve state and dev-buy quotes through core SDK functions
- agencybook (read-only): packages/core/src/launch/sign.ts, build.ts, verify.ts; apps/web/app/components/LaunchIsland.tsx; apps/web/app/api/launch/prepare and submit; apps/web/lib/rate-limit.ts; apps/worker/src/sentry.ts; packages/core/src/db/client.ts and migrate.ts; .railway/railway.ts; .planning/phases/09-launch-flow-and-launch-safety/09-RESEARCH.md and 09-05-SUMMARY.md; CLAUDE.md stack notes
- npm registry `npm view <pkg> time --json`, `exports`, `peerDependencies`, `scripts` (2026-10-19)
- next@16.3.8 tarball `dist/compiled/@next/font/dist/google/font-data.json`
- pump-sdk 4.1.0 `dist/index.d.ts` (`computeFeesBps`, `selectCurveFeeSchedule`)
- Local benchmarks on Apple M4: solana-keygen 3.0.13 grind (130M keys in 298 s), Node ed25519 keygen (37,229 and 33,934 keys/s/thread)
- [Phantom: Domain and transaction warnings](https://docs.phantom.com/developer-powertools/domain-and-transaction-warnings)
- [Phantom: Solana priority fees](https://docs.phantom.com/developer-powertools/solana-priority-fees)
- [Phantom: Lighthouse](https://docs.phantom.com/developer-powertools/lighthouse)
- [Phantom: Browse deeplink](https://docs.phantom.com/phantom-deeplinks/other-methods/browse)
- [Phantom: Establishing a connection](https://docs.phantom.com/solana/establishing-a-connection.md)
- [Railway: Private networking, how it works](https://docs.railway.com/networking/private-networking/how-it-works)
- [Railway: Variables reference](https://docs.railway.com/reference/variables)
- [Railway: Config as code](https://docs.railway.com/reference/config-as-code)
- [Sentry: Next.js manual setup](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/)
- [Sentry: Data collected](https://docs.sentry.io/platforms/javascript/guides/nextjs/data-management/data-collected/)
- [Pinata: Uploading files](https://docs.pinata.cloud/files/uploading-files)
- [Pinata: Retrieving files (gateways)](https://docs.pinata.cloud/gateways/retrieving-files)
- [Biome: noRestrictedImports](https://biomejs.dev/linter/rules/no-restricted-imports/)
- [pnpm: Dependency resolution settings](https://pnpm.io/settings/dependency-resolution)

### Secondary (MEDIUM confidence)
- [Sentry blog: dataCollection control panel](https://blog.sentry.io/datacollection-control-panel)
- [releases.sh: sendDefaultPii deprecated for dataCollection](https://releases.sh/release/rel_Cz9aaiZxy5WYggXGGb-Do-senddefaultpii-deprecated-for-datacollection-option)
- [Neon pricing](https://neon.com/pricing), [Neon compute lifecycle](https://neon.com/docs/introduction/compute-lifecycle)
- [Helius pricing](https://www.helius.dev/pricing)
- [Pinata pricing](https://pinata.cloud/pricing)
- [Railway: Private networking guide](https://docs.railway.com/guides/private-networking), [Library configuration](https://docs.railway.com/networking/private-networking/library-configuration)

### Tertiary (LOW confidence)
- [Solana Commerce Kit wallet connection](https://solana.com/docs/tools/commerce-kit/quickstart/wallet-connection) (Wallet Standard `standard:events` usage, third party)
- Third-party Phantom mainnet observation (rebeltrenches/signal-platform PRs, via agencybook 09-RESEARCH)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH. Every pin dated on the registry; most are agencybook's production versions.
- Architecture: HIGH for sign order, byte compare and the chain path (production plus devnet evidence); MEDIUM for the worker HTTP design (straightforward, unproven here).
- Pitfalls: HIGH for the devnet minimum and the builder venue gap (measured and read from code); MEDIUM for Sentry v11 option shapes and Phantom events.

**Research date:** 2026-10-19
**Valid until:** 2026-11-02 for versions (14-day window moves); 2026-11-18 for architecture
