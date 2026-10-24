---
phase: 03-indexer-lists-and-token-page
plan: 03
subsystem: share-card
tags: [og-image, share-card, next-og, metadata]
requires: []
provides:
  - /coin/{mint}/opengraph-image/card (coin share card, generateImageMetadata)
  - /opengraph-image (site share card)
  - lib/og.tsx siteCard and coinCard
  - lib/pinata.ts imageUrl and fetchCardImage
  - lib/launches.ts landedCoin (cached landed lookup shared by page, metadata and card)
  - SITE_URL web variable and metadataBase
affects: [03-14]
tech-stack:
  added: []
  patterns: [next/og ImageResponse with static TTF instances read by fs, capped streaming fetch to a data URI]
key-files:
  created:
    - apps/web/lib/og.tsx
    - apps/web/app/coin/[mint]/opengraph-image.tsx
    - apps/web/app/opengraph-image.tsx
    - apps/web/assets/og/BigShoulders-ExtraBold.ttf
    - apps/web/assets/og/SchibstedGrotesk-Regular.ttf
    - apps/web/assets/og/SchibstedGrotesk-SemiBold.ttf
    - apps/web/assets/og/OFL.txt
    - apps/web/e2e/og.e2e.ts
  modified:
    - apps/web/lib/pinata.ts
    - apps/web/lib/pinata.test.ts
    - apps/web/lib/launches.ts
    - apps/web/components/coin-identity.tsx
    - apps/web/app/coin/[mint]/page.tsx
    - apps/web/app/layout.tsx
    - apps/web/next.config.ts
    - apps/web/proxy.ts
    - apps/web/e2e/README.md
    - .env.example
decisions:
  - "03-03: the coin card route sets its cache-control explicitly (immutable for a landed coin, public max-age=300 for the site card) and is force-dynamic, so dev serves what production does and Next never keeps the first render of a mint that lands later"
  - "03-03: the page's per-process landed lookup moved to lib/launches.ts as landedCoin, so page, metadata, generateImageMetadata and the card share one cached read (Neon budget)"
  - "03-03: fetchCardImage reads the body through a capped stream reader, so a response with no content-length is still refused past 2 MB without buffering it whole"
metrics:
  duration: 14 min
  completed: 2026-10-23
  tasks: 2
  files: 18
---

# Phase 3 Plan 03: Share Card Summary

A BONDR token link now unfurls as a 1200x630 card. It shows the coin image, the name, "{SYMBOL} on BONDR" and the proof box: "0", "Dev holds 0 launch supply" and "Insta burned at launch" or "Insta sold at launch". It carries no other number. Unknown mints and all other pages get the "Built to bond." site card.

## Tasks

| Task | Name | Commits | Files |
| ---- | ---- | ------- | ----- |
| 1 | Share card e2e, static fonts and the image fetch guard | ae8132f (test, RED), 90c1bab (feat) | e2e/og.e2e.ts, e2e/README.md, assets/og/*, lib/pinata.ts, lib/pinata.test.ts, components/coin-identity.tsx |
| 2 | Coin and site share cards, metadataBase and SITE_URL | e5e9f98 | lib/og.tsx, both opengraph-image.tsx, lib/launches.ts, coin page, layout.tsx, next.config.ts, proxy.ts, .env.example |

## Fonts

- Source: google/fonts at commit e7db6ca603fd4862010383ff17ffd6cc4ffac1c0, files `ofl/bigshoulders/BigShoulders[opsz,wght].ttf` and `ofl/schibstedgrotesk/SchibstedGrotesk[wght].ttf` (raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/...).
- Commands:
  - `uvx --from fonttools fonttools varLib.instancer bs.ttf wght=800 opsz=72 --static -o BigShoulders-ExtraBold.ttf` (opsz 72 is the font's default and maximum, the display size)
  - `uvx --from fonttools fonttools varLib.instancer sg.ttf wght=400 --static -o SchibstedGrotesk-Regular.ttf`
  - `uvx --from fonttools fonttools varLib.instancer sg.ttf wght=600 --static -o SchibstedGrotesk-SemiBold.ttf`
- OFL.txt holds both families' copyright lines followed by the shared OFL 1.1 text. The two upstream files differ only in the licence URL.

## Verification

- `pnpm exec playwright test apps/web/e2e/og.e2e.ts apps/web/e2e/coin.e2e.ts`: 14 passed. The og spec failed before the routes existed (RED).
- `pnpm lint`, `pnpm typecheck`, `pnpm --filter @bondr/web build`, `sh scripts/check-client-bundle.sh`: all clean. `pnpm test`: 123 passed, 1 skipped.
- Checked by hand under `next start`: the coin card is `public, immutable, no-transform, max-age=31536000`, an unknown mint is `public, max-age=300`, and no `x-nextjs-cache` is set on the dynamic card. The coin page emits og:image, twitter:image (same URL), og:image:alt, twitter:card summary_large_image and the description. Rendered PNGs were checked visually: a letter fallback card, a card with an embedded gateway PNG, and the site card.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Explicit immutable header and force-dynamic on the coin card**
- **Found during:** Task 2
- **Issue:** ImageResponse sends `no-cache, no-store` under `next dev`, where the e2e runs, so the immutable check could not pass there. The build also marks the route SSG (`[__metadata_id__]` from generateImageMetadata), so Next could keep a mint's first render.
- **Fix:** The route sets `public, immutable, no-transform, max-age=31536000` itself for a landed coin and adds `dynamic = "force-dynamic"`.
- **Commit:** e5e9f98

**2. [Rule 2 - Neon budget] Shared cached lookup**
- **Found during:** Task 2
- **Issue:** Calling `launchByMint` from generateImageMetadata and from the card would add uncached Neon reads on every page view and every card fetch. The page's hour and minute cache lived in page.tsx, which may not export it.
- **Fix:** Moved `read()` and the cache into `lib/launches.ts` as `landedCoin` (BASE58_KEY check, per-process map, React `cache`). The page, metadata and both card functions use it.
- **Commit:** e5e9f98

**3. [Rule 2 - DoS] Capped body read**
- **Found during:** Task 1
- **Issue:** A content-length check alone lets a chunked response with no length be buffered whole.
- **Fix:** `readCapped` streams the body and cancels the read past 2 MB. `pinata.test.ts` also covers `fetchCardImage`: no gateway, path smuggling, WEBP, oversize and a thrown fetch.
- **Commit:** 90c1bab

**4. [Rule 1 - Bug] Site card art position**
- **Found during:** Task 2 visual check
- **Issue:** Satori ignored `right: 0` on the absolute hero and drew it on the left.
- **Fix:** Positioned with `left: 480, top: 0`.
- **Commit:** e5e9f98

## Notes for the owner

- **Staging needs SITE_URL on the web service, available at build time.** Without it, Next falls back to `http://localhost:3000`. The static pages (/terms, /launch) bake og:image in at build. Not changed on Railway (out of scope here, 03-14).
- The Pinata dedicated gateway returns 403 for CIDs this account has not pinned, so those coins get the letter card. This is the case for the recent e2e fixture rows. Real launches pin through this account, so their images embed.
- T-03-03-04 (accepted): Satori fetches emoji and non-Latin glyphs from its CDNs server-side when a name has them. If that fetch fails, only those glyphs are dropped.
- TOKEN-06 is left unticked in REQUIREMENTS.md: the plan's success criterion checks it on staging with Telegram and the X validator in 03-14.

## Self-Check: PASSED
