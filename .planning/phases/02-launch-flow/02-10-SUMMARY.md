---
phase: 02-launch-flow
plan: 10
subsystem: web-pinning
tags: [pinata, ipfs, rate-limit, upload]
requires: [02-05, 02-06, 02-07, 02-08]
provides:
  - "lib/pinata.ts: metadataJson(fields, imageCid), ipfsUri(cid), pinFile(blob, filename, jwt, fetchFn), PinError (status only)"
  - "lib/guard.ts: BASE58_KEY, take(key, now, limit, windowMs), clientIp(req), rateLimited(req, scope, limit, windowMs, wallet?)"
  - "POST /api/launch/pin: multipart image + meta JSON; returns { uri, cid, imageCid }"
  - "Rate limits: pin 5 per 10 min per IP and per wallet, quote 60 per min per IP, consent 10 per 10 min per IP"
  - "LaunchErrorCode pin_failed"
  - "next/image remotePatterns: ipfs.io/ipfs/** and the PINATA_GATEWAY host when set"
  - "e2e/pin.e2e.ts: the route's refusals (403, consent_required, invalid_input, 413, 429)"
affects: [02-11, 02-13, 02-18]
tech-stack:
  added: []
  patterns:
    - "Rate-limit entries carry their own end time, so a sweep never shortens another scope's window"
    - "Playwright sends a random X-Real-IP per runner process, so the per-IP limits never carry across e2e runs on a reused dev server"
key-files:
  created:
    - apps/web/lib/pinata.ts
    - apps/web/lib/pinata.test.ts
    - apps/web/lib/guard.test.ts
    - apps/web/app/api/launch/pin/route.ts
    - apps/web/lib/README.md
    - apps/web/e2e/pin.e2e.ts
  modified:
    - apps/web/lib/guard.ts
    - packages/core/src/api.ts
    - apps/web/app/api/quote/route.ts
    - apps/web/app/api/consent/route.ts
    - apps/web/next.config.ts
    - playwright.config.ts
decisions:
  - "The pin route checks origin, then the declared length (413 before reading; a missing length also gets 413), then parses, then rate limits by IP and wallet, then consent, then the field and image rules"
  - "The uploaded file name is never forwarded to Pinata: files are named <SYMBOL>.<type> and <SYMBOL>.json"
  - "A database error on the consent read returns 503 with no body and logs only the SQLSTATE, as the consent route does"
  - "BASE58_KEY moved from the consent route into guard.ts, shared by consent and pin"
metrics:
  duration: ~9 min
  completed: 2026-10-19
  tasks: 2
  files: 12
---

# Phase 2 Plan 10: Pinata pinning and rate limits Summary

A consented dev's image and metadata JSON are now pinned to IPFS through Pinata by `POST /api/launch/pin`, before anything is signed. The route returns an on-chain URI of `https://ipfs.io/ipfs/<cid>`, which is 80 characters. It refuses a cross-site call, an oversize body, an unconsented wallet, a non-image file and invalid fields, and none of those refusals uploads anything. Pin, quote and consent now share one in-memory fixed-window limiter, which returns a 429 `{ error: "rate_limited" }` with `retry-after`.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 | Pinata helpers and rate limiter with unit tests | 4514804 |
| 2 | Pin route, rate limits on quote and consent, image hosts, lib README, pin e2e; one live pin | 1aa5d9e |

## Verification

- `pnpm vitest run`: 67 passed and 1 skipped (the live Pinata case). `pnpm lint`, `pnpm typecheck` and `pnpm --filter @bondr/web build` exit 0 after each commit. The build lists `ƒ /api/launch/pin`.
- `PINATA_LIVE=1 pnpm vitest run apps/web/lib/pinata.test.ts`: 5 passed, including the live pin of a 1x1 PNG and its metadata.
- `pnpm exec playwright test`: 39 passed. That includes the 5 new pin cases and the existing consent, launch-form, wallet, terms and paused specs, all with the new limits in place.
- Acceptance greps:
  - `consent_required` is in the pin route.
  - `rateLimited` is in the pin, quote and consent routes.
  - There is no `server-only` in pinata.ts or guard.ts.
  - `ponytail:` is in guard.ts, `"pin_failed"` is in api.ts, and apps/web/lib/README.md exists.
- `rg -l 'pinata_jwt' apps/web --glob '!e2e' --glob '!*.test.ts'` lists the pin route and `next.config.ts`. The next.config.ts hit is the 02-02 `WEB_ENV` allowlist entry. It copies the name from the root .env and never reads the value. Only the pin route reads `process.env.pinata_jwt`.

## Live test pins (all unpinned)

These were test pins only, with no coin behind them.

- **Unit test (PINATA_LIVE=1):** `bondr-test-pin.png` (a 1x1 PNG) and `bondr-test-pin.json` (metadata named "BONDR test pin").
- **Through the route:** curl against the local dev server, with no secret on argv. A fresh random test wallet was consented first through `/api/consent` (204). The pin was the same 1x1 PNG with metadata named "BONDR test pin", symbol TESTPIN, and an `x.com/bondr` link normalized by the route. The response was 200:
  - `uri`: `https://ipfs.io/ipfs/bafkreic2zxyxqgusssfurt5ddrsnyu7j5bi56tfegpse4wkaxrw6swuzyi`. That is 80 characters: 21 for the prefix plus a 59-character CIDv1.
  - `imageCid`: `bafkreidlp6sdj6jkroakvmbntpy2clsj77foijheae5byt3iwz7d2k542a`, also 59 characters.
- **The image was deduplicated.** Both runs uploaded the same PNG, so both got the same image CID, and Pinata kept one file for it. The four uploads left three files on the account: one image and two metadata JSONs.
- **Cleanup:** a `node --env-file=.env` fetch script read `pinata_jwt` from `process.env` and listed each file by name. It then deleted each file through `DELETE /v3/files/public/<id>`, and all three deletes returned 200. A follow-up listing by CID returned 0 files for every test CID: bafkreidlp6...k542a, bafkreidrwq...poskxi and bafkreic2zx...swuzyi.
- **Wallet row:** the test wallet's `wallets` row was deleted afterwards, and the dev branch has 0 `wallets` rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The sweep could reset a longer window**
- **Found during:** Task 1
- **Issue:** The agencybook `take()` swept by the caller's window. With several scopes, a 60 s quote sweep would have deleted a pin entry that was still inside its 10-minute window.
- **Fix:** Each entry stores its own end time, and the sweep deletes only expired entries.
- **Commit:** 4514804

**2. [Rule 3 - Blocking] The e2e suite would trip the new per-IP limits**
- **Found during:** Task 2
- **Issue:** Next dev gives every e2e request the same client IP, and the dev server is reused across runs. A second run within 10 minutes would exceed the consent limit of 10.
- **Fix:** playwright.config.ts sends a random `x-real-ip` per runner process (each worker loads the config). pin.e2e.ts sets its own IP per test. Production is unaffected, because Railway's proxy sets X-Real-IP.
- **Commit:** 1aa5d9e

**3. [Rule 2] Pin route e2e**
- **Added:** `e2e/pin.e2e.ts`, which was not in files_modified. It is the runnable check for the route's refusals: a cross-site call gets 403, an unconsented wallet gets 403 `consent_required`, an SVG and the symbol `ab-c` get 400 `invalid_input`, a 4.2 MB body gets 413, and the sixth attempt from one IP gets 429 with `retry-after`.
- **Isolation:** each worker group consents its own address and deletes it afterwards. A shared address would have been deleted under a test still running in another worker; the first run failed on a closed client for this reason.
- **Commit:** 1aa5d9e

**4. [TypeScript] erasableSyntaxOnly**
- `PinError` declares `status` as a plain field, not as a constructor parameter property.
- **Commit:** 4514804

### Notes

- The 413 check refuses a request with no `content-length`, so a chunked body cannot stream past the cap. Browsers always send the length for a FormData fetch.
- `fetch` failures and timeouts (30 s) become `PinError(0)`. Any Pinata failure logs only the status and returns 502 `pin_failed`. A missing `pinata_jwt` logs the variable name, never a value.

## TDD Gate Compliance

There is no separate RED commit, per the orchestrator rule never to commit a failing test. In Task 1 the unit tests were written alongside the helpers and committed together in 4514804. They were not observed failing first.

## Requirements

None ticked. LAUNCH-07 is also listed by 02-13 and 02-18.

## Known Stubs

None. Nothing in the UI calls the pin route yet. 02-13 wires it at row 1 of step 4 and maps `pin_failed` and `rate_limited` to the UI-SPEC copy.

## Notes for later plans

- **02-11:** to add the prepare limit, call `rateLimited(req, "prepare", n, windowMs, wallet)` after the wallet is parsed. `BASE58_KEY` is exported from guard.ts.
- **02-13:** send `FormData` with `image` (the File) and `meta` (a JSON string of wallet, name, symbol, description and links). Reuse the returned `uri` and `imageCid` on retries instead of pinning again. The pin limit is 5 per 10 minutes per wallet.
- **Phase 3:** the free plan holds 500 files, and every launch attempt pins two (RESEARCH Pattern 10).

## Threat Flags

None beyond the plan's threat model:
- **T-02-10-01:** magic bytes, the 4 MB cap and the early 413 are in place, and SVG is refused (e2e).
- **T-02-10-02 and T-02-10-06:** per-IP and per-wallet limits are in place, and the consent row is checked before any upload.
- **T-02-10-03:** `sameOrigin` is checked first.
- **T-02-10-04:** the JWT is read only in the route, and errors carry only a status.
- **T-02-10-05:** rules.ts runs on the server, and links are normalized to https.

## Self-Check: PASSED

- All 6 created files are present.
- Commits 4514804 and 1aa5d9e are on phase-02-launch-flow.
