# apps/web/lib

Server and client helpers for the web app. Files that import `server-only` must never reach a client component.

- `db.ts`: server-only re-export of `@bondr/core/db` (`db()` and the tables).
- `guard.ts`: POST guards: `sameOrigin`, `json` (capped body), `BASE58_KEY`, and the fixed-window `take`, `clientIp`, `rateLimited`.
- `guard.test.ts`: rate limit windows, client IP choice and the 429 response.
- `worker.ts`: server-only `workerGet` and `workerPost`, the bearer-token proxy to the worker.
- `worker.test.ts`: contract errors (410, 422, 409) pass through, anything else becomes worker_unavailable.
- `launches.ts`: server-only `launchView` and `launchByMint`, a launch row's public fields (never the message or the signed wire).
- `launch-run.ts`: the step 4 network sequence (pin, prepare, sign, submit, poll) and `getView`.
- `pinata.ts`: `metadataJson`, `ipfsUri` and `pinFile` (Pinata v3 uploads). The pin route supplies the JWT.
- `pinata.test.ts`: metadata shape, URI length, upload request and JWT redaction; a live pin with `PINATA_LIVE=1`.
- `format.ts`: display formats `sol`, `pct`, `compact`, `short`, `explorer`, `age`, and the Phase 3 `mcapSol`, `tradeSol`, `signedPct`, `curvePct`, `relTime`, `thousands`.
- `trades.ts`: server-only `tradesPage(mint, before?)`, the trade feed paged by (slot, seq) keyset, and `parseCursor`.
- `coins.ts`: server-only `coinByMint(mint)`, the indexed coin row with 1h and 24h volume and 1h change computed at read (burns excluded); the query is `coinRow` in `@bondr/core/coin-row`, shared with the worker's live events.
- `coins.test.ts`: windowed volume, 1h change from the last trade before the hour or the launch price, unknown mint (Neon dev; skips without DATABASE_URL).
- `trades.test.ts`: cursor parsing, and pages with no overlap and no gap down to the launch rows (Neon dev; skips without DATABASE_URL).
- `format.test.ts`: the display formats.
- `use-status.ts`: `useStatus()`, polls `/api/status` every 10 s.
- `live-hub.ts`: server-only `hub`, the process's one upstream to the worker's `/events` NDJSON stream, with a 2,000-event replay ring and `resync` on a gap; `createHub`, `splitLines` and `Ring` are its pure parts.
- `live-hub.test.ts`: line splitting, ring replay bounds, mint filter, client replay or resync, upstream gap resync, a failing subscriber dropped.
- `use-live.ts`: `useLive({ mint?, onTrade, onLaunch, onBond, onHolders, onResync })`, one EventSource on `/api/live`; returns `"live"`, `"reconnecting"` or null before the first open.
- `flash.ts`: `flashClass(side, kind)`, the buy or sell flash (value) or rise-and-flash (row) class, empty under prefers-reduced-motion.
- `terms.ts`: `TERMS_VERSION`, stored with each consent, and `consentMessage`, the text Phantom signs at consent (browser and server share it).
- `session.ts`: server-only consent proof (CR-01): `issueNonce`, `verifyConsent` (Ed25519 through `@bondr/core/sig` and nonce expiry; the consent route spends each nonce once as a `consent_nonces` row), `sessionCookie`, `sessionWallet` and `consentRequired`, plus `pinProof` and `pinnedHere`, which tie a prepare to metadata the pin route built (worker-core WR-06). Nonce, cookie and pin proof are HMACs with `SESSION_SECRET`.
- `session.test.ts`: nonce expiry, wrong signer, tampered nonce, cookie expiry and edits, pin proof scope.
- `cn.ts`: `cn()`, clsx plus tailwind-merge.
