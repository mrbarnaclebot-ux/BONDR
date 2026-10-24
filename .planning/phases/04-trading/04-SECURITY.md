---
phase: 04
slug: trading
status: verified
threats_total: 54
threats_closed: 54
threats_open: 0
asvs_level: 1
created: 2026-10-25
---

# Phase 04 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register: every `<threat_model>` block of 04-01..04-13 PLAN.md (54 threats: 49 mitigate, 5 accept, 0 transfer).
> Evidence is code (file:line) or a test on branch phase-04-trading at d2659a9, which includes the 04-REVIEW fixes
> (both fix logs). Deployment-only mitigations cite 04-13-SUMMARY (Railway, Neon and Helius were not called for this
> audit). Trade unit tests re-run for this audit: trade-quote, trade-prepare, trade-submit, trade-store,
> trade-state, quote, trade-error, trade, trade-button, trade-run (10 files, 92 passed, 1 skipped: TRADE_LIVE).
> Paths: `worker/` = apps/worker/src, `core/` = packages/core/src, `web/` = apps/web.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| live chain state -> quote math | decoded curve and pool accounts feed the preview the trader trusts before signing | reserves, fee configs |
| browser -> web /api/trade/quote | public, untrusted side, mint, amount, slippage | query fields |
| browser -> web /api/trade/balance, prepare, submit, [id] | untrusted bodies, origins and cookies; the session cookie names the wallet | mint, amounts, signed wire, trade id |
| browser localStorage | untrusted stored slippage | bps integer |
| web -> worker /trade/* | private HTTP, bearer token; web adds the session wallet, the worker re-parses everything | wallet, trade fields, signed wire |
| worker memory store | built messages kept for submit's byte compare | message bytes, wallet binding |
| worker -> Helius | credits per uncached read, simulation and send; key in the RPC URL | API key in URL, signed tx |
| Phantom -> browser | the only key that signs; returns the signed wire | signed tx |
| worker error codes -> browser copy | codes decide what the trader is told | contract error codes |
| local Surfpool fork -> mainnet RPC | fork reads mainnet state through the Helius key | API key in URL |
| e2e -> dev branch DB | seeded fixture coins written and removed | test rows |
| e2e -> devnet (local and via staging) | real sim-wallet spend, capped | devnet SOL |
| owner Mac -> Railway | redeploy of staging web and worker | deploy only, no variables |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation (evidence) | Status |
|-----------|----------|-----------|-------------|------------------------|--------|
| T-04-01-01 | R | quote.ts fee breakdown | mitigate | core/quote.ts:13-14 computeFeesBps/computeAmmFeesBps, :21,215 resolveMultiHopRoute legs; :68-71,122-131 rates masked by leg (protocol, creator, lp); no rate literal in quote.ts, quote-read.ts or worker/trade-quote.ts (rg; literals only in quote.test.ts fixtures); quote.test.ts:78-95 protocol only on the BONDR hop, creator only on the coin hop | closed |
| T-04-01-02 | T | minAmountOut in the quote | accept | See AR-01; the real floor is T-04-04-03 | closed |
| T-04-01-03 | I | api.ts in the web bundle | mitigate | core/api.ts has no import statement (rg `^import`); biome.json:26-46 noRestrictedImports on apps/web allows @bondr/core/api, not quote or pump; package.json:21 check:bundle | closed |
| T-04-02-01 | T | parseTrade | mitigate | worker/trade-quote.ts:41 digits only (1..20), :43 buy 1..MAX_SOL_IN, sell under 2^64, :45 integer slippage 10..5000, :46 BONDR mint refused, :31-35 knownCoins else not_found; trade-quote.test.ts:44,51,73 | closed |
| T-04-02-02 | D | readMintState | mitigate | worker/trade-state.ts:12-13 2 s mint and 60 s config TTL, :18-27 single flight, failed read evicted; callers pass only BONDR or a knownMint result (trade-quote.ts:78-80, trade-prepare.ts:97-101); trade-state.test.ts:51,67,77 | closed |
| T-04-02-03 | S | /trade/balance wallet | mitigate | worker/trade-quote.ts:100-103 wallet only from the body web builds; web/app/api/trade/balance/route.ts:11,18 sends sessionWallet, body supplies only mint | closed |
| T-04-02-04 | I | worker logs | mitigate | worker/http.ts:94 500 path through redact; trade-prepare.ts:57 estimate, :88-90 refuse; trade-submit.ts:54-55 settle; trade-quote.ts logs nothing | closed |
| T-04-02-05 | R | fee values | mitigate | worker/trade-quote.ts:88-93 hops only from hopInputs(live state, cfg) and SDK configs; no rate literal (as T-04-01-01) | closed |
| T-04-03-01 | D | /api/trade/quote | mitigate | web/app/api/trade/quote/route.ts:11 rateLimited 120 per 60 s per IP; worker single flight (T-04-02-02) | closed |
| T-04-03-02 | T | quote body | mitigate | quote/route.ts:5,13 1 KB JSON cap, :15-21 only side, mint, amount, slippageBps forwarded; worker re-parses (T-04-02-01) | closed |
| T-04-03-03 | S | quote route | mitigate | quote/route.ts reads no session and forwards no wallet (no `wallet` token in the file); worker quoteTrade takes none (trade-quote.ts:75-97) | closed |
| T-04-03-04 | R | fee rows | mitigate | web/components/trade-quote.tsx:60-62,90,137 render only quote fields (h.*Bps, q.fees.platformFee); no fee-rate constant in apps/web | closed |
| T-04-04-01 | T | parseTrade and devnet cap | mitigate | worker/trade-prepare.ts:196 parseTrade, :95-104 capDevnetBuy before routeFor (:200), cap now the smaller of BONDR's and the coin's curve (trade-quote.ts:67-73, review S-WR-04); core/route.ts:23 throws on a zero floor; trade-prepare.test.ts:114, trade-quote.test.ts:122,135 | closed |
| T-04-04-02 | S | prepare wallet | mitigate | worker/trade-prepare.ts:197-199 walletOf on the body wallet only; web/app/api/trade/prepare/route.ts:8,20-23 copies FIELDS (no wallet) then adds sessionWallet; e2e trade-routes.e2e.ts:41-60 body wallet ignored | closed |
| T-04-04-03 | T | minAmountOut | mitigate | core/route.ts:21-24 floor from the route's fresh expectedOut; worker/trade-prepare.ts:179-193 final simulation with the real floor, :211,216-217 one compile, those exact bytes stored | closed |
| T-04-04-04 | R | message contents | mitigate | worker/trade-prepare.ts:212 checkMessage (core/send.ts:25-35 allowlist, :66-73) then routeOnly (:136-168: budget ixs first, exactly one multi_hop_swap, System transfer only to the user's WSOL ATA; review S-WR-03); trade-prepare.test.ts:172,191,198,224,228 | closed |
| T-04-04-05 | D | trade store | mitigate | worker/trade-store.ts:26-27 120 s TTL and 5,000 cap, :33-35 sweep on insert, drop oldest; web prepare/route.ts:15 30 per 10 min per IP and wallet; trade-store.test.ts:13,24 | closed |
| T-04-04-06 | D | Helius credits | mitigate | prepare reads: cached state (trade-state.ts), one simulate (trade-prepare.ts:185), getLatestBlockhash (:209), getBlockHeight (:218); per-wallet limit as T-04-04-05; own path, not the launch queue (trade-prepare.ts:5, main.ts `POST /trade/prepare`) | closed |
| T-04-04-07 | I | estimator and simulation errors | mitigate | worker/trade-prepare.ts:57 and :88-90 redact; refuse returns only the contract code (:90 fail(out)); http.ts:95 500 body is `{error:"build_failed"}`; heliusEstimate error text carries no URL (:83) | closed |
| T-04-05-01 | S | balance route | mitigate | web/app/api/trade/balance/route.ts:11 sessionWallet, :15 consentRequired, :16-18 body read only for mint | closed |
| T-04-05-02 | D | balance route | mitigate | balance/route.ts:13 30 per 60 s per IP and wallet; web/lib/use-balance.ts:11,25-43 fetched on connect and visibilitychange, no interval; use-run.ts:40 one bounded reread 2 s after a landed trade (review C-WR-09, not a loop) | closed |
| T-04-05-03 | T | stored slippage | mitigate | web/lib/use-trade.ts:30-38 stored value must be an integer 10..5000 bps, else 1%; worker re-checks (trade-quote.ts:45) | closed |
| T-04-05-04 | T | high slippage | mitigate | use-trade.ts:30 DEFAULT_BPS 100; trade-quote.tsx:19 HIGH_BPS 500, :198-200 "This trade can fill up to X% below the quote" | closed |
| T-04-05-05 | R | fee rows | mitigate | core/quote.ts:202 platformFee "0", api.ts:161 literal type "0"; trade-quote.tsx:137 renders it; e2e trade.e2e.ts:133,143 coin hop has no "Pump protocol" row | closed |
| T-04-06-01 | E | submitTrade | mitigate | worker/trade-submit.ts:105 sameMessage(stored, wire, 1) (core/cosign.ts:28-31 exact length, raw slice compare) and signatureOk on slot 0 vs stored wallet; :17,33 wire capped at 1,232 bytes; stored bytes passed checkMessage and routeOnly at prepare (trade-prepare.ts:212); trade-submit.test.ts:84 | closed |
| T-04-06-02 | S | trade id | mitigate | worker/trade-store.ts:36 randomBytes(16); trade-submit.ts:16,26 id format, :38-42 wallet-bound, else 404; :97-100 repeat submit is a read, re-read after the await; trade-submit.test.ts:100,127,138 (concurrent submits send once) | closed |
| T-04-06-03 | T | settle | mitigate | worker/trade-submit.ts:69-70 unknown keeps its signature, never resent; :81-82 signed set synchronously before broadcast; :88-90 settled by status only; trade-submit.test.ts:240 | closed |
| T-04-06-04 | I | settle errors | mitigate | worker/trade-submit.ts:54-55 redact; :44-49 view returns only state, signature, amountOut, code; preflight logs used only for the code map (:86-87), never logged or returned | closed |
| T-04-06-05 | D | live test | accept | See AR-02 (trade-prepare.test.ts:242-245 skipIf TRADE_LIVE, simulation only) | closed |
| T-04-07-01 | S | prepare, submit, poll | mitigate | web prepare/route.ts:13, submit/route.ts:14,23, [id]/route.ts:21,23 sessionWallet only; e2e trade-routes.e2e.ts:41-60 body wallet gives insufficient_balance for the empty session wallet | closed |
| T-04-07-02 | T (CSRF) | all trade routes | mitigate | sameOrigin first in quote:9, balance:10, prepare:12, submit:13; [id]/route.ts:15 a present foreign Origin is 403; web/lib/guard.ts:23 json() requires application/json; e2e trade-routes.e2e.ts:22-26 cross-origin is 403 | closed |
| T-04-07-03 | E | submit | mitigate | web submit/route.ts:21-23 forwards only tradeId, signed and the session wallet; worker byte compare decides (T-04-06-01) | closed |
| T-04-07-04 | D | prepare and submit | mitigate | prepare/route.ts:15, submit/route.ts:15 30 per 10 min per IP and wallet; [id]/route.ts:19 240 per minute; e2e trade-routes.e2e.ts:62-72 31st submit is 429 | closed |
| T-04-07-05 | I | poll | mitigate | [id]/route.ts:21-22 no session is consent_required, :17 id format else 404; worker owned() 404 for another wallet (trade-submit.ts:38-42,112); e2e trade-routes.e2e.ts:28-39 | closed |
| T-04-08-01 | T | closing the sheet mid-trade | mitigate | web/components/trade-sheet.tsx:60 busy = phase not idle, :69 close ignored while busy, :79-82 Escape, :84 a forced close reopens (review C-WR-01), :85 backdrop, :47 resize waits; e2e trade-sheet.e2e.ts (resize during flight, result kept) | closed |
| T-04-08-02 | D | hidden panel quoting | mitigate | web/lib/use-trade.ts:132-145 IntersectionObserver or open sheet, :120-130 tab visible, :216 loop runs only when visible, idle and amount set; trade-sheet.tsx:37,41 setVisible | closed |
| T-04-09-01 | R | PumpSwap fee rows | mitigate | scripts/spike/stages/multihop.ts:4-5,59 pureQuote recorded, :127-130 rule fails when the gap exceeds 1 base unit | closed |
| T-04-09-02 | I | spike logs and fork.json | mitigate | scripts/spike/run.ts:20 errors through redact; results.ts:55-60 the whole file redacted before write; rg over results/fork.json finds no api-key, helius, secret or http text | closed |
| T-04-09-03 | T | real funds | accept | See AR-03 | closed |
| T-04-10-01 | S | trade-run request bodies | mitigate | web/lib/trade-run.ts:116-117 prepare body has no wallet, :61-62 submit body is tradeId and signed; use-balance.ts:28 `{ mint }`; use-route-quote.ts:54 quote fields only; :112-123 address change or disconnect before submit throws switched (review C-WR-06) | closed |
| T-04-10-02 | T | signing | mitigate | web/components/wallet.tsx:35-36,53 solana:signTransaction only; no signAndSend call in apps/web (rg); worker byte compare refuses any change (T-04-06-01) | closed |
| T-04-10-03 | T | unknown result | mitigate | trade-result.tsx:115-122 unknown copy with Solscan link; trade-run.ts:47-64 a posted wire is never re-signed, :76-90 not_found and deadline end unknown (review C-WR-05, C-CR-02), :87 re-posts the same signed wire only while the row is still prepared (worker treats a repeat as a read); e2e trade-results.e2e.ts:135-154 | closed |
| T-04-10-04 | T | over-15% impact | mitigate | web/lib/trade-button.ts:12,132-136 "anyway" label above 15%; :72-75,120 only a quote for the current side and amount, not loading, arms it (review C-CR-01); Phantom signature follows; prepare re-simulates with the floor (T-04-04-03); e2e trade-run.e2e.ts:119 | closed |
| T-04-10-05 | D | devnet sim wallet | mitigate | scripts/devnet-launch.ts:54,67-79 top-up only under 0.03 SOL, ops floor refused; web/e2e/trade.e2e.ts:250-256 --fund, :305 spend at most 0.05 SOL; :258-262 wallets row removed after unless launches reference it (FK) or on staging | closed |
| T-04-11-01 | T | unknown result | mitigate | trade-result.tsx:115-122 "Check Solscan before you trade again"; no retry control resends (trade-run.ts:59-64,87 same wire only) | closed |
| T-04-11-02 | T | high impact | mitigate | web/lib/format.ts:88-89 impactBand warn from 5%, error above 15%; trade-result.tsx:86-101 callouts; trade-button.ts:132-136 anyway before any prepare | closed |
| T-04-11-03 | I | error copy | mitigate | trade-result.tsx:11,26-53 fixed copy per code, default FALLBACK; :121-129 callouts are fixed strings; trade-run.ts:29 only the error code crosses; worker returns codes only (http.ts:93-95) | closed |
| T-04-12-01 | T | leftover fixture rows | mitigate | every Phase 4 spec that seeds also drops in afterAll: trade.e2e.ts:40-41, trade-callouts.e2e.ts:46-47 (both coins), trade-results.e2e.ts:79-80, responsive-trade.e2e.ts:38-39, trade-run and trade-sheet (one seed, one dropCoin each) | closed |
| T-04-12-02 | I | screenshots | accept | See AR-04 | closed |
| T-04-13-01 | E | staging deploy | mitigate | 04-13-PLAN.md:44 owner pre-approval 2026-10-24 for devnet staging deploys; 04-13-SUMMARY.md:46 only staging worker and web deployed, no variable changed, no other project or environment | closed |
| T-04-13-02 | I | WORKER_TOKEN and Helius key | mitigate | 04-13-SUMMARY.md:46,101 no variable printed or changed; apps/web/instrumentation.ts and scripts/check-client-bundle.sh unchanged since e970c0e (Phase 2) | closed |
| T-04-13-03 | D | devnet sim wallet | mitigate | 04-13-SUMMARY.md:69 no top-up needed, net spend -0.017843 SOL against the 0.05 cap; controls as T-04-10-05 | closed |
| T-04-13-04 | T | real Phantom byte stability | accept | See AR-05 | closed |
| T-04-13-05 | R | sign-off evidence | mitigate | 04-13-SUMMARY.md:40-41 deployment ids, :60-65 signatures and feed timings, :69 balances | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*
*Category: S spoofing, T tampering, R repudiation, I information disclosure, D denial of service, E elevation of privilege*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-04-01-02 | The quote's minAmountOut is display only; prepare recomputes the floor from a fresh simulation inside the stored bytes (T-04-04-03) | owner (04-01 plan) | 2026-10-25 |
| AR-02 | T-04-06-05 | The live test runs only with TRADE_LIVE=1, simulates only, and sends and spends nothing | owner (04-06 plan) | 2026-10-25 |
| AR-03 | T-04-09-03 | Fork SOL only; nothing touches devnet or mainnet balances | owner (04-09 plan) | 2026-10-25 |
| AR-04 | T-04-12-02 | Screenshots show stubbed amounts and fake test accounts only; no real wallet or key appears | owner (04-12 plan) | 2026-10-25 |
| AR-05 | T-04-13-04 | The Playwright mock cannot prove Phantom keeps the message bytes (A5). HV-04-01 is the owner's manual check (04-13-SUMMARY.md:85). If Phantom rewrites a message, the worker fails closed with message_changed and the "did not match" copy (trade-submit.ts:105-107, trade-result.tsx:42-45) | owner (04-13 plan) | 2026-10-25 |

*Accepted risks do not resurface in future audit runs.*

---

## Unregistered Flags

None. Six SUMMARY files have a `## Threat Flags` section. Each maps to registered ids: 04-02 (T-04-02-03), 04-03
(T-04-03-01..04), 04-04 (`outbound-rpc` getPriorityFeeEstimate: T-04-04-07), 04-05 (T-04-05-01..05), 04-06 and 04-07
(their plan registers), 04-13 (T-04-13-01, -02, -03, -05). The other seven summaries have no section.

Informational, outside the register (from 04-REVIEW.md and the two fix logs):
- Review money-safety fixes verified in code: S-CR-01 "Sold for" from the sell leg's event (trade-submit.ts:59-63);
  S-WR-01 error codes keyed by raising program (core/trade-error.ts:8-19); S-WR-02 preflight mapped from its own
  logs (trade-submit.ts:86-87); S-WR-03 routeOnly (T-04-04-04); S-WR-04 coin-curve cap (T-04-04-01); S-WR-05
  concurrent-submit test (trade-submit.test.ts:138); C-CR-01 stale-quote gate (T-04-10-04); C-CR-02 poll deadline
  and abort (trade-run.ts:11,76-90); C-WR-05 unknown after posting (T-04-10-03).
- routeOnly has a `ponytail:` allowance: an ATA create for another owner (the buyback ATA) passes; its rent is the
  only leak (trade-prepare.ts:135). The allowed shape was checked against SDK 4.1.0 source; the fix log asks for one
  `TRADE_LIVE=1` run to confirm it on devnet. That run is not recorded.
- S-IN-01: the Helius priority estimate path is unreachable until Phase 7 adds mainnet; keep T-04-04-07 in that
  phase's register. S-IN-06: mintState keys on the base mint only; safe for today's two callers.
- C-WR-06 residual: if Phantom rejects before React sees the new address, the result reads "declined", not
  "switched". Copy only; nothing is sent.
- C-WR-05 assumes every code in web/lib/trade-run.ts:49-57 REFUSED means the worker never broadcast. True at
  d2659a9 (trade-submit.ts:101-108 refuse before send; :86-87 preflight rejection). Re-check if submit changes.
- Deployment note: staging runs the 04-13 build (deploys 7c6377e9 and 389cdab8), which predates every review fix,
  including routeOnly, the coin-curve cap and the stale-quote gate. They reach staging with the next approved deploy.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-10-25 | 54 | 54 | 0 | gsd-security-auditor (claude-opus-5-5) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-10-25
