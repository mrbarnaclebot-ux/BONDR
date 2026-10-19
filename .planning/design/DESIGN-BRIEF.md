# BONDR Design Brief (v1 mockups)

Produced with `shape`, run non-interactively. Discovery answers come from PROJECT.md and REQUIREMENTS.md (owner interview, 2026-10-18/19). Confirm or override the items in section 9.

## 1. Feature summary

BONDR is a Solana memecoin launchpad where the dev never holds launch supply and pre-bond creator fees are forced into bonding and burning the coin. v1 needs five surfaces: discovery (home), the token page (chart, trade, proof, ledger), the launch flow, consent and terms, and an owner-only admin console. The UI has to make the trust mechanic legible in seconds and stay out of a trader's way.

## 2. Primary user action, per screen

| Screen | The one thing |
|--------|---------------|
| Home | Spot a coin worth opening; see live that coins here bond and burn |
| Token | Verify "dev holds 0, fees burn" and trade without leaving the page |
| Launch | Launch a coin in one signature, understanding the exit is mandatory and irreversible |
| Consent | Decide, in one read, whether BONDR may remember the wallet |
| Admin | See what is unhealthy or stuck and fix it safely (simulate, then sign) |

## 3. Discovery answers

**Who:** memecoin devs who want buyer trust; traders who want coins without dev bags. Starts with the owner and friends, later the public. Admin is the owner alone, often reacting to an alert.

**State of mind:** traders are fast and suspicious, scanning on a phone between charts. Devs are excited but anxious at signing time (sniping, irreversible exit). The owner in admin is focused and sometimes under stress (a stuck finalize, a seed leak).

**Data ranges:** lists from 0 to 500+ coins; market caps from about 5 SOL to several thousand SOL; bond progress 0 to 100%; ledger from 1 entry (launch) to hundreds (24h collections); trade feed updates several times per second on a hot coin; 4 to 20 W wallets per state in admin.

**Dynamic content:** market cap, 1h change, bond progress, trade feed, burn budget, 24h window countdown, worker heartbeat. All push via SSE in production; the mockups tick with a little JS.

**Edge cases:** no search results; launches paused (kill switch or BONDR awaiting migration, pump error 6107); dev buy under 0.25 SOL; Phantom rejected or timed out; coin bonded by traders first (fallback burn); a stuck worker step; ops wallet below threshold; EVACUATE.

**Constraints:** static HTML now; production is Next.js 16, Tailwind, lightweight-charts. Phantom is the only wallet. Responsive 390 / 768 / 1440 with no horizontal scroll. WCAG AA. No emoji anywhere.

**Anti-goals:** a pump.fun clone in green; casino energy (confetti, rocket copy, flashing everything); generic dashboard cards; purple gradients; glassmorphism; marketing hero with three feature cards. The biggest risk is burying the proof: if a holder cannot find "dev holds 0" and the ledger in one glance, BONDR has no reason to exist.

## 4. Design direction

Three words: **auditable, combustive, unhurried**. The physical object is an assay office receipt crossed with a trading terminal: stamped proofs, ruled ledgers, numerals you could audit by hand, and a quiet green furnace underneath.

- **Theme:** dark, because traders live in dark terminals during long sessions. Palette is fixed (tokens.css): text #ebf3ea, background #1a1a1a, primary #a2d59c, secondary #32712a, accent #56c44a. Neutrals are tinted toward the green. One derived semantic red (#f0705e) for sells and errors. Burn is shown in accent green, never fire orange: the furnace is the brand's own colour.
- **Type:** Big Shoulders Display (condensed industrial signage) for wordmark, headings and stamped numerals. Schibsted Grotesk (sturdy newsprint grotesk) for UI and body. Martian Mono, condensed width, for every number, address and signature, with tabular figures.
- **Shape language:** hairline rules over boxes, 2px radii, no drop shadows. Sections are separated by rules and space. Proof elements use a stamp treatment (double rule, big numeral). The ledger uses a perforated receipt edge.
- **Signature elements:** the "0" proof stamp on every token page; the burn-budget meter with a fixed trigger notch at 105%; the live "burn tape" on home that streams ledger events across the platform.

## 5. Layout strategy per screen

- **Home:** slim live burn tape under the header; a short left-aligned statement plus a "closest to forced bond" rail (real data, not decoration); then the list controls (segmented Trending / Top / Latest / Oldest + search) and a dense table. On mobile the table becomes two-line rows; bond progress stays visible.
- **Token:** desktop is a three-zone terminal: identity bar across the top (name, mint, price, proof stamp); left column chart then the bond module then the ledger; right column sticky trade panel then trade feed. Tablet stacks with the trade panel after the chart. Mobile: trade panel becomes a sticky Buy / Sell bar that opens a bottom sheet.
- **Launch:** stepper (Coin, Dev buy and exit, Review, Sign, Live). Form on the left, a live receipt preview on the right that fills in as the dev types and always shows what happens to fees. On mobile the receipt follows the form.
- **Consent:** dialog over a dimmed home; under it, the terms page as a single reading column (65ch).
- **Admin:** dense console. Balances and kill switches first (what can hurt), then health, then W wallets table, then the selected coin timeline, then inspector, moderation and audit log, with EVACUATE isolated at the bottom behind a typed phrase.

## 6. Key states

| Area | States |
|------|--------|
| Header | disconnected (Connect Phantom), connecting, connected (short address, disconnect) |
| Home lists | default, live tick (cell flash), new row slide-in (Latest), search empty result, launches paused banner |
| Token | pre-bond (meter, countdown, curve fees 2.45%), post-bond finalized (80/20 permanent, PumpSwap fees 1.75%), trade quote, slippage warning above 5% impact, mobile sheet open |
| Launch | empty form, field errors (length, dev buy below 0.25 SOL), exit not chosen (button disabled), review, waiting for Phantom, server co-sign, confirmed, rejected, paused |
| Consent | first connect prompt, decline (stay browsing, wallet disconnected) |
| Admin | healthy, warning (ops low), stuck step with retry, simulation modal (balance changes, destinations), EVACUATE armed / disarmed |

## 7. Interaction model

- Live values flash a tint for 600 ms in their direction (green up, red down) and settle; no blinking.
- Segmented controls switch lists instantly with a sliding indicator.
- Trade panel recomputes the quote on every keystroke; preset chips fill the amount; the button label states the exact action ("Buy GRUB with 1.00 SOL").
- Every chain link opens Solscan in a new tab and shows a monospace short signature.
- Admin: every money-moving action opens a simulation dialog first; confirm requires a fresh wallet signature. EVACUATE enables only when the typed phrase matches exactly.
- Motion respects `prefers-reduced-motion` (tape and flashes stop).

## 8. Content requirements

- Proof copy: "Dev holds 0 launch supply" + "Exit: insta burn in the launch transaction" + tx link.
- Fee copy, always with the numbers: "Curve fees 2.45%: 0.95% pump protocol, 1.5% creator to this coin's burn budget. BONDR adds no platform fee."
- Exit copy: insta sell, "Your buy is sold back in the same transaction; you keep the SOL, not the tokens." Insta burn, "Your buy is burned in the same transaction; supply shrinks and you get nothing back." Streamflow lock, "Coming later".
- Paused copy: "Launches paused while BONDR migrates to PumpSwap. Trading is unaffected. Launches resume automatically."
- Errors say what happened and what to do: "Minimum dev buy is 0.25 SOL. Enter 0.25 or more."
- Empty search: "No BONDR coin matches 'pepe'. Search looks at name, symbol and mint."

## 9. Open questions for the owner

1. USD alongside SOL? Mockups show SOL first with USD secondary; PROJECT.md says SOL-equivalent everywhere.
2. Should the home page show platform-wide burn totals (the tape) at launch, when there may be only a few events?
3. Holder count source: our indexer or Helius DAS? Mockups show it as a number only.
4. Admin on mobile: mockups make it work at 390px, but is a phone admin a real use case beyond EVACUATE?
5. OG preview card (TOKEN-06) is not mocked; it should reuse the proof stamp.

## 10. Recommended references used

spatial-design, typography, color-and-contrast, interaction-design, motion-design, responsive-design, ux-writing.

---

## 11. Round 2 direction (2026-10-19, owner feedback: "feels very flat; more fluid, modern, artistically designed")

**Core message changes.** The platform headline is no longer "dev holds nothing". The central idea is **every coin is built to bond**: fees exist to push each coin to its bond, then burn. "Dev holds 0 launch supply" stays on token pages and the launch success state as a trust badge.

Headline options:
1. **Built to bond.** (used) Supporting copy: "Every coin on BONDR launches with one job: reach its bond. Until it does, its creator fees buy its own curve to completion and burn what they buy."
2. **Every coin is meant to bond.**
3. **Fees push. Coins bond. Supply burns.**

**From flat terminal to layered instrument.** Same palette and type, new depth:
- **Elevation.** Three surface tiers tinted from #32712a, 12 to 20px radii, an inner top highlight, and layered shadows tinted toward the green (`--elev-1`, `--elev-2`). There are no neutral gray drop shadows.
- **Light.** Radial light leaks in secondary and accent behind the page, local glows behind key moments (trade panel, proof badge, selected exit, the next coin to bond), and faint film grain over everything.
- **Signature motif: the bond.**
  - Node A (the coin, solid accent) and node B (the bond, outlined) are joined by a link that fills with the curve.
  - The nodes pull together as the coin nears its bond and pulse once it is above 90%.
  - At 100% node B fills and a ring radiates.
  - It is used in every coin card, the Next to bond panel, the token page's Curve filled gauge, the fee flow and the launch stepper.
- **The bond moment.** The generated art shows two liquid forms joined by a glowing bridge. It is used in:
  - the home hero (a seamless 6s video loop with a still poster);
  - the token page's post-bond "Forced by its own fees" block, with the coin orb radiating rings;
  - the launch success state.
- **Fluid motion.**
  - A gentle spring easing (`--ease-spring`, one small overshoot, no bounce) on segment indicators, cards, buttons and sheets.
  - Scroll-linked reveals with stagger, the hero loop and drifting motes, and coin-art glows that drift slowly.
  - All of it stops under `prefers-reduced-motion`; the hero falls back to the still.
- **Coin cards.** The coin art bleeds into the card: a blurred, saturated copy of the avatar fills the card head, with the crisp avatar on top. Text always sits on a solid surface, so contrast holds.

**Home layout.**
1. Hero with the Next to bond panel, which replaces the old "closest to a forced bond" rail.
2. Live ledger tape.
3. **Trending** as its own horizontal scroller with scroll-snap, mouse drag, arrows on desktop and a peek of the next card on mobile.
4. **All coins** with Top / Latest / Oldest tabs as a card grid: 5 / 3 / 2 / 1 columns at 1200 / 900 / 560 px. Below 560 px each card turns horizontal for density.

**Still banned.** Glassmorphism soup (blur is used only on the sticky header, mobile bars and scrims), purple gradients, the three-feature-card hero, gradient text and emoji.
