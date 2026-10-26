# Block-0 sniping and bot prevention for BONDR

Researched 2026-10-26. Research role, read-only on code. Not committed.

## Answer

Nothing on the pump.fun program can stop another wallet from buying in the same slot as our create. The program has no creator-only window, no time-decaying fee and no allowlist, so block-0 sniping can only be made harder, cheaper to survive, and visible. The cheapest real fix is a gap in our own flow: the launch tx is broadcast through the plain RPC (`sendRawTransaction`), not Helius Sender, even though PROJECT.md says launches need a private path (`PROJECT.md:87`, `:112`). Moving the launch to Sender (with a tip inside the create tx) shortens the time between our tx leaving the worker and the leader, which is the only window a sniper can use. After that, the effective levers are post-hoc: record each trade's slot offset from the create slot (the indexer already stores `slot`), show a "sniped %" on the token page, and optionally delay public listing on our site. A fee that decays with time or market cap-at-slot is impossible without our own program. Mandatory create + dev buy in one tx is already done and is not a snipe defence by itself, because the dev exits in the same tx.

## What our current launch flow exposes

Flow: browser POST /prepare, worker builds the tx, user signs in Phantom, POST /submit, worker cosigns with the mint key and broadcasts.

- Create, dev buy and exit (sell or burn) are one atomic tx: `PROJECT.md:139`, `REQUIREMENTS.md:27`. Create uses the SDK's `createV2Instruction` (`packages/core/src/launch.ts:49`). So there is no gap between create and the dev buy for a sniper to enter. There is also no supply left for the dev to protect: the dev holds 0 child tokens after the exit (`PROJECT.md:23`).
- The mint pubkey is chosen at prepare and returned to the browser: `apps/worker/src/prepare.ts:163-172` (reserve), `:253-257` (returned as `mint`). It is also in Postgres (`vanity_mints`, `launches.mint`). The mint secret never leaves the worker (`vanity.ts:1-3`, derived from seed); the worker adds the mint signature only at submit (`submit.ts:43-56`). So the pubkey is known to the dev's browser and Phantom up to about 60 s (`signBy`, `prepare.ts:123`) before the tx lands. Only the dev could leak it; there is no public listing of it before the create lands. Good already.
- The pre-generated `bndr` suffix pool (`grind.ts:96`) is private in the DB. A bot can recognise a BONDR launch by the suffix only after the create is visible, which is too late to matter.
- A per-coin address lookup table is created on chain before the launch, paid by the ops wallet (`build.ts:63-73`, `prepare.ts:218-222`, about 5 s for a new table). It holds the non-signer accounts derived from the mint (bonding curve, its ATA, W-related accounts); the mint itself is a signer and is skipped (`alt.ts:17-25`). A bot cannot invert a PDA to the mint, so this leaks timing ("a BONDR launch is being prepared") and the curve PDA, not an actionable mint. Low risk. Inference, not tested.
- Broadcast is `conn.sendRawTransaction(raw, { maxRetries: 3 })` through the configured RPC (`packages/core/src/send.ts:237-245`, called from `apps/worker/src/submit.ts:69`). Helius Sender (tip + `skipPreflight`) exists only for the forced-bond and burn path (`fee-send.ts:118-158`, `fee-burns.ts:32`). `REQUIREMENTS.md` FEE-02 covers Sender for the bond; no requirement covers the launch tx. This is the main gap against `PROJECT.md:87`.
- Launch tx size is tight: a child create on BONDR's curve is 1,064 bytes, 1,163 after BONDR migrates, against a 1,232 limit (`PROJECT.md:20`, `send.ts:22`). A tip transfer (tip account key not in the ALT, per Jito's advice, plus the transfer ix) adds roughly 60 to 70 bytes. It fits, but the post-migration case has about 70 bytes of headroom. Measure before promising.
- `REQUIREMENTS.md:109` already records "Preventing dev buys from other wallets: impossible on-chain; accepted by owner". `PROJECT.md:179` accepts snipers on the forced-bond buy. There is no recorded decision on block-0 snipers of the launch itself.
- Child coins are quoted in BONDR (`PROJECT.md:20`): buying needs a BONDR leg (multi_hop or SOL-to-BONDR then child). A generic pump.fun sniper that only sends a SOL `buy` will not work on a BONDR-quoted curve without custom code. This is friction, not a defence (inference; unconfirmed that bots lack it).
- The indexer stores `trades.slot` and `seq` per trade (`schema.ts:248-276`) and coins can be hidden (`schema.ts:160`). The data for post-hoc detection already exists.

## How snipers actually see and hit a launch

- Detection: Yellowstone gRPC / Geyser subscriptions parse the pump `Create` instruction (first 8 bytes of ix data) from successful txs. Quoted latency 5-20 ms for gRPC vs 150-300 ms for websockets; these are vendor numbers. Sources: [Chainstack Geyser guide](https://docs.chainstack.com/docs/solana-listening-to-pumpfun-token-mint-using-geyser), [Shyft gRPC example](https://docs.shyft.to/solana-yellowstone-grpc/examples/pumpfun/solana-grpc-pumpfun-new-token-detection), [RPC Fast](https://rpcfast.com/blog/how-to-launches-snipe-pump).
- Landing: bots submit through Jito, Astralane or Sender-style multi-relay paths with dynamic tips, from co-located nodes. RPC Fast claims 89% slot-0 landing for co-located Frankfurt vs under 20% for generic cloud (its own benchmark, vendor source, unconfirmed independently). Same article: slot 0 vs slot 2 is a 20-60% price difference (cited to AllenHark; unconfirmed).
- A bot reacting to the create at processed commitment can still land in the same slot if the leader is still building it; that is the premise of "block-0 sniping". Pine Analytics (via a search summary, not fetched) says same-block sniping is now the dominant launch pattern on pump.fun; treat as unconfirmed.
- Creator-side bundling tools (Smithii, j.tools, Froglabs and similar) sell create + creator buys in one Jito bundle. All of them admit it protects only the creator's own buys in that block: "Block two is open to everyone" ([Cryptwerk](https://cryptwerk.com/post/pump-fun-first-block-sniper-bots-jito-bundling/), [BEX](https://bex.co/blog/2026/04/22/meme-launchpad-2-pump-fun-letsbonk-anti-sniper-bonding-curve-professionalization)). These are marketing sources; read them as the sellers' framing.

## What pump.fun itself offers

- No anti-sniper feature found. The pump-public-docs index lists coin creation, creator fee, creator fee sharing, holder rewards, cashback (deprecated, no new coins), fee recipients and a fee program; nothing about sniper protection or creation-slot restrictions ([pump-public-docs](https://github.com/pump-fun/pump-public-docs), [COIN_CREATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/instructions/COIN_CREATION.md): "does not address" restrictions on buying in the creation slot).
- Fees are dynamic by market cap tier (`calculateFeeTier` in the fee program doc; [FEE_PROGRAM_README](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/FEE_PROGRAM_README.md)). Nothing depends on time or slot. Tier values are in an image I could not read. We cannot change tiers or add a slot term.
- The SDK can build create + buy in one tx (`create_v2_and_buy` in the Rust client); this is what BONDR already does.
- Search found no official pump.fun announcement of a sniper defence. "Mayhem mode" appeared only as a name in a bot page with no explanation: unconfirmed, ignore.
- The Believe/Mediora curve with high early fees that decay as market cap grows is the one real dynamic-fee anti-bot design found; it is Believe's own program, not pump's ([Solana Compass](https://solanacompass.com/learn/Lightspeed/what-weve-learned-from-pumpfuns-sniping-problem), AI-generated notes, low confidence).

## Private submission: what it does and does not buy

- Helius Sender sends to Helius, Jito, Harmonic and Rakurai at once. Requires a tip (Sender Max 0.001 SOL min; SWQOS-only 0.000005 SOL min) and a priority fee; `sendBundle` takes up to 4 txs. MEV protect is an optional `mev-protect=true` flag. The docs do not claim the tx is hidden from validators ([Helius Sender](https://www.helius.dev/docs/sending-transactions/sender)).
- Jito bundles: up to 5 txs, atomic, one slot, minimum tip 1000 lamports. Docs do not claim bundles are hidden from the public; they say Jito never explicitly leaks them but they can be exposed in uncled-block events and rebroadcast un-bundled ("uncle bandit"). Mitigation: put the tip in the same tx as the core logic ([Jito low latency send](https://docs.jito.wtf/lowlatencytxnsend/)).
- `jitodontfront`: a read-only account with that prefix forces the tx to index 0 of a bundle ([Jito docs](https://docs.jito.wtf/lowlatencytxnsend/#sandwich-mitigation)). It stops reordering inside our bundle, not a third party's tx landing after it in the same slot.
- Conclusion: private paths narrow the leak window (the tx goes straight to leaders instead of through RPC retransmission). They do not make a tx invisible to a leader-adjacent bot, and they cannot stop a bot whose tx lands later in the same slot. Treat as risk reduction.

## Methods table

| Method | Stops block-0? | Works on pump program? | Cost / complexity for BONDR | Recommendation |
|---|---|---|---|---|
| Atomic create + creator buy in one tx | Only gap between create and creator buy; not later same-slot buys | Yes | Done (LAUNCH-03) | Keep |
| Send the launch via Helius Sender with in-tx tip | Reduces leak window; does not stop a same-slot buy after our tx | Yes | Low-medium: tip ix at build, size check (about 70 B headroom post-migration), signed message is byte-compared at submit so tip must be in the prepared tx, mainnet-only | Do first (Phase 7) |
| Jito bundle with a second tx (extra creator buys) | No (same as above) | Yes | Medium: user-signed tx plus our tx; dev must not hold supply anyway | Skip |
| Bundle buys for the creator across wallets | Gives creator supply, which BONDR forbids | Yes | N/A | Do not do; contradicts the no-dev-bag promise |
| `jitodontfront` in the launch tx | No, only ordering inside a bundle | Yes | Low if bundling | Skip unless we bundle |
| Keep mint pubkey secret until create lands | Already true outside the dev's browser | Yes | Done; keep prepare window short | Keep; do not publish mint/ALT before landing |
| Randomise launch timing / ALT-before-launch | No effect on a bot that reacts to the create | Yes | Low | Skip; ALT leak is timing only |
| Staked connections / own validator forwarding | Faster landing for us, not blocking others | Yes | Helius covers it via Sender | Covered by Sender |
| Time or slot-decaying fee (high fee in first N slots) | Would make slot-0 uneconomic | No | Needs own program / own curve | Impossible on pump |
| Token-2022 transfer hook to tax early buys | Would tax early trades | No | Pump mints use no hook; hook set at mint creation by the pump program | Impossible on pump |
| Dynamic market-cap fee tiers | Not slot-based | Already exists in pump | Cannot configure | Not a lever |
| Creator-only or whitelist window | Would stop it | No | No such instruction in the program | Impossible on pump |
| Post-hoc flag: trades with `slot - createSlot <= N` | No, but exposes it | Yes | Low: indexer has slot and seq; one derived column or query | Do (second) |
| "Sniped %" on token page | No, deters and informs | Yes | Low once flag exists | Do with the flag |
| Exclude flagged wallets from anything BONDR controls | Partly (only things we control) | Yes | Low-medium; see below | Optional, decide per feature |
| Delayed public listing on our site (hide coin for N seconds) | No on chain; stops copy-bots scraping our feed | Yes | Low: `hidden_at` exists, auto-unhide by time | Optional; weak, bots use Geyser not our site |
| BONDR-quoted curve (need BONDR leg to buy) | Friction for generic bots | Already so | None | Note only; unconfirmed it deters anyone |

## BONDR-specific levers

- W fee wallet: sniper buys pay the creator fee into W, so sniping does not hurt W's burn budget. The harm is retail entry price and optics, not the fee engine. No W change is needed.
- Burn/bond mechanics: forced bond buys with the full budget and burns (`PROJECT.md:30`). A sniper holding bags at bonding is exposed to the same pool-price fill; nothing to change.
- Things BONDR controls that could exclude flagged wallets: any future airdrop, rewards, leaderboard or "verified holder" badge. Today there are none in v1. Do not build exclusion with nothing to exclude from.
- Launch timing randomisation does not help: the create tx is the signal, and the dev picks when to sign.
- Delayed listing: hide the coin from the site feed for the first few seconds. Bots use the chain, so the benefit is only against scrapers of our own feed. Unconfirmed that any watch our site.

## Recommended plan (smallest effective first)

1. Put the launch broadcast on Helius Sender (mainnet only, devnet keeps plain RPC like `fee-send.ts` does). Add the tip transfer to the prepared tx (same tx as the logic, per Jito), keep the priority fee, and add a size assertion in `compileLaunch` for the migrated-BONDR 1,163-byte case. Reuse `tipIxs`/`SENDER_URL` from `fee-send.ts:118-158`. Add a requirement (for example LAUNCH-xx) so it is tracked; today FEE-02 only covers the bond.
2. Confirm the tip is in the dev-signed message: the worker cosigns by byte compare against the stored message (`submit.ts:43-56`), so the tip must be added at prepare, and the cost shown in the preview (`networkFee`).
3. Record sniping, no prevention claim: add `createSlot` to a coin (or derive it from the earliest trade) and compute `slot - createSlot` per trade in the indexer. Show "sniped %" (supply bought by wallets in slots 0 to 2, excluding the dev and W) on the token page. One query over `trades`, no new table.
4. Decide later, only if a feature needs it: exclusion lists, delayed listing. Do not build them now.
5. Copy for users: state plainly that BONDR cannot prevent third-party buys at launch and shows how much was sniped. Do not market "sniper-proof".

Open decision for the owner: tip size. Sender Max minimum is 0.001 SOL; a lower tip still routes best-effort on fewer paths. Failed launches would cost the dev nothing extra only if the tip is inside the tx (it reverts with it). Pick a default and put it in the cost preview.

## What is impossible without our own program

- A fee that starts high and decays by slot or time. The pump fee program tiers by market cap only.
- A Token-2022 transfer hook or fee on early buys. The mint is created by pump's `create_v2`; we do not choose its extensions.
- A creator-only first slot, an allowlist window, or a minimum delay between create and first public buy.
- Blocking specific wallets from buying on the curve.
- Per-coin max buy size per wallet or per slot.

Any of these would mean running our own bonding curve program (a different product: audit, no pump.fun distribution, no PumpSwap migration). Out of scope for v1.

## Unconfirmed

- Pine Analytics "dominant launch pattern" claim and the RPC Fast and AllenHark landing-rate numbers: vendor or secondary sources, not verified.
- Whether any pump.fun anti-sniper or "Mayhem mode" feature exists: no primary source found. Check pump.fun's own announcements before mainnet.
- Exact bytes added by the Sender tip to the launch tx: estimate only; measure with `messageSize`.
- Whether Jito or Helius paths keep a tx invisible to leader-adjacent bots: docs are silent. Do not state it to users.
- Whether generic bots can buy a BONDR-quoted curve.
