# Anti-vamp measures for BONDR (research)

Date: 2026-10-26. Status: research only, nothing built. For Phase 7 planning.

## Recommendation

1. Build the 24h ticker cooldown, enforced in the worker's `prepare`, as one indexed read of `launches`. It is enforceable because BONDR only lists coins it launched itself (see facts). Cost: one migration (a partial index), one pure function, one new error code, about 60 lines plus one test.
2. Do not build a `ticker_locks` table yet. `prepare` is already single-flight inside one worker process (`prepare.ts:287`), which closes the race between concurrent prepares. Add the table only if the worker is ever run as more than one instance (upgrade path below).
3. The symbol charset is already `A-Z0-9` only, so Unicode, homoglyph and zero-width tricks cannot reach the ticker. Normalisation of the ticker is therefore tiny. The weak spot is the free-form name, not the ticker.
4. Cheap extras worth taking: oldest-first tie-break and a "first" marker in search (no new data), and an exact image-CID duplicate check (one indexed read). Skip perceptual image hashing for v1.
5. Be honest in copy: a cooldown stops exact-ticker vamps on BONDR only. It does not stop `PEPE2`, `PEPEE`, or a relaunch on pump.fun itself.
6. Not a real-money item, so it can ship in Phase 7 under the autonomous rule; the only owner call is the policy question list at the end.

## Current code facts

Validation (identical in browser, web server and worker, `packages/core/src/rules.ts`):
- `rules.ts:31` `checkSymbol`: trim, `toUpperCase()`, max 13 (`SYMBOL_MAX`, `rules.ts:5`), must match `^[A-Z0-9]+$`. No `$`, spaces, punctuation or non-ASCII survive. The browser also uppercases on input (`launch-coin.tsx:108`).
- `rules.ts:24` `checkName`: trim only, max 32 bytes, any Unicode. No normalisation, no charset limit. Name is the loophole.
- `prepare.ts:91` `parseRequest` re-runs all checks on the worker ("trusts nothing it is sent"); `imageCid` must match `^[A-Za-z0-9]{1,100}$` (`prepare.ts:49`); `uri` must be an ipfs.io or mypinata gateway URL (`rules.ts:8`).

Prepare flow (`apps/worker/src/prepare.ts`):
- `admit` (`:132`) runs the cheap guards: blocked wallet first (`:143`, D-30), then `prepareGuard` (`:101`: paused, invalid_input, consent_required, rate_limited). Rows read in one `Promise.all`: consent, hourly table count, wallet daily count, prior table, blocked.
- `prepareOne` (`:250`): `admit`, then `getBalance` (`:256`, RPC), then `reserveMint` (`:163`, takes a vanity mint from the pool and does an RPC `getAccountInfo`), then table creation (ops pays rent, about 0.006 SOL), then `insertPrepared` in `finish` (`:212`).
- Best insertion point: inside `admit`, as one more member of the existing `Promise.all`, and a refusal in `prepareGuard`-style (pure function). That is before the balance RPC, before the mint is reserved and before any ops spend. No extra round trip: it runs in parallel with the reads already there.
- Single-flight: `prepare()` chains every call on a module-level promise (`prepare.ts:285-291`, "ponytail: single-flight"). One process, so two prepares never interleave.

Storage:
- `launches` (`packages/core/src/schema.ts:62`): `symbol` text (`:74`), `name`, `image_cid`, `state` in prepared/signed/sent/landed/failed/unknown, `landed_at`, `created_at`. Indexes today: only unique `launches_landed_mint` and `launches_inflight_mint` plus `signature` unique. No index on `symbol`.
- `coins` (`schema.ts:117`): one row per landed launch, holds `hidden_at`/`hidden_reason` (`:160`) for moderation; has no symbol (joined from `launches`). Indexes `coins_launched_at`, `coins_mcap_sol`.
- Migrations `packages/core/migrations/0000..0006`; next is `0007`.
- Failed launches: `settle.ts:104` moves to `failed` and releases the vanity mint. `insertFailed` (`launches.ts:21`) also records paid-table failures with state `failed`. So "landed" is the only state that is a real coin.

Image upload: browser posts to `apps/web/app/api/launch/pin/route.ts`, which pins the file and metadata JSON to Pinata (IPFS) and returns `imageCid` and `uri`. Pinning is content-addressed, so byte-identical images give an identical CID; no hashing code exists and none is needed for exact matches. Perceptual hashing does not exist.

Refusal path to the UI:
- Worker throws `fail({ error: code })` (`http.ts`); status mapping per code lives in `http.ts`.
- Codes: `LaunchErrorCode` union, `packages/core/src/api.ts:22`. `ApiError` (`:50`) has `reason?: string` (used by admin `not_applicable`), no numeric field.
- UI copy: `FAULTS: Record<Code, Fault>` in `apps/web/components/launch-sign.tsx:42`. It is a total `Record`, so a new code will fail typecheck until added there, and in any other `Record<LaunchErrorCode, ...>` (`rg "rate_limited"` also hits `trade-result.tsx`, `wallet.tsx`, `lib/guard.ts`, `lib/launch-run.ts`, `lib/trade-run.ts`, `lib/admin-copy-actions.ts`, `lib/admin-copy-sim.ts`; let `tsc` find the exact ones). Copy is static text per code, so an hours figure needs either a small function in `Fault` or a second field on `ApiError` (see design).

Can a pump.fun-direct coin be listed on BONDR? No. The indexer only knows coins from launch rows: `knownCoins` (`ingest.ts:19`) is filled from the `coins` table and from `ingestLaunch` of a BONDR launch row (`:154`); trades for unknown mints are ignored (`:225` skips unknown mints). Search says "Only coins launched on BONDR are listed" (`home-search.tsx:117`). So the BONDR namespace is closed and a cooldown over `launches` is complete for BONDR. The reverse also holds: a vampire can launch the same ticker on pump.fun, where BONDR has no say.

Search today: `lib/coins.ts:32-37` `ilike` on name and symbol, ordered by D-03 orders with ties by newest launch.

## Practice survey

What was found (web search, 2026-10-26; mostly secondary sources, treat as indicative):
- Solana and most chains impose no naming restrictions, so copying an existing coin is trivial. A study of pump.fun (arXiv, "Meme Coin Factories", https://arxiv.org/html/2609.10246v1) counts about 5.4M copycats (36%) sharing name and symbol under its broadest method (may include false positives) and reports competition usually kills copycats, occasionally both graduate.
- pump.fun: no published duplicate-ticker or cooldown rule found. Treat "pump.fun has no ticker uniqueness" as likely but unconfirmed.
- Four.meme (BSC): Fair Mode "Token Name Protection": once a token passes 100 holders on the curve, name and ticker lock for 72 hours (https://cryptoslate.com/products/four-meme/, third-party; confirm against four.meme docs). This is the one concrete precedent found. Note it protects only tokens that proved traction (100 holders), which makes it far harder to grief than a blanket lock.
- LetsBonk/bonk.fun, Believe, Moonshot, Meteora-based launchpads: nothing found on ticker locks, uniqueness windows, image hashing or reserved tickers. Comparison pages (https://bitbank.nz/blog/memecoin-launchpads-compared, https://coinbureau.com/analysis/best-memecoin-launchpads) say tickers are simply not unique. Unconfirmed either way.
- Wider norms, from general knowledge, unsourced here: centralised exchanges and listing sites reserve top tickers; name-squat protection on registries uses NFKC plus confusables mapping (Unicode UTS #39) and strips zero-width characters; marketplaces show oldest or highest-liquidity "verified" first. None of this has a cited launchpad precedent.

Conclusion: no major launchpad was found enforcing a blanket ticker cooldown. BONDR doing so is a differentiator, not a convention, and carries a griefing risk that Four.meme avoided by gating on holders.

## Design: 24h ticker cooldown

Rule: a ticker cannot be prepared if a launch with the same key landed in the last 24h, or is in flight.

Normalisation (pure, in `packages/core/src/rules.ts`, beside `checkSymbol`):
```
tickerKey(symbol) = symbol.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "")
```
`checkSymbol` already guarantees `A-Z0-9`, so this is the identity today; it is cheap insurance if the charset ever loosens, and strips a leading `$` if one slipped in. Optional leet fold (default off, ask owner): map `0->O`, `1->I`, so `B0NK` collides with `BONK`. Skip `5->S`, `3->E` etc. (false positives on real tickers like `3X`). Do not run a Cyrillic confusables table on the ticker: unreachable. Apply the same function in the browser for an early hint only; the worker is the authority.

What counts (state):
- `landed` with `landed_at > now() - interval '24h'`: holds the lock.
- `signed`, `sent`, `unknown`: in flight, may land, holds the lock.
- `prepared` and created in the last 3 minutes by a different wallet: holds the lock (the sign window is capped at 60 s, `prepare.ts:signBy`). Older prepared rows are abandoned and do not hold it.
- `failed`: never holds it. Expired and failed launches free the lock automatically because they stop matching.
- Same wallet re-preparing its own in-flight ticker (retry after a closed tab): not blocked by its own `prepared` row; `reusable` logic at `prepare.ts:101` already handles the table reuse.

Schema (migration `0007_ticker_cooldown.sql`, mirror in `schema.ts` launches indexes):
```
CREATE INDEX launches_symbol_live ON launches (symbol, landed_at)
  WHERE state IN ('landed','signed','sent','unknown','prepared');
```
`symbol` is stored already normalised (uppercase, A-Z0-9), so the key equals the column and no new column is needed. The partial index excludes `failed`, so it stays small. A reviewer can add a `CHECK (symbol = upper(symbol))` but it is not required.

Query (one indexed read, runs inside the existing `Promise.all` in `admit`):
```
select max(case when state='landed' then landed_at + interval '24h'
                else created_at + interval '3 minutes' end) as until
from launches
where symbol = $key and wallet <> $wallet_if_prepared ... 
  and ( (state='landed' and landed_at > now()-interval '24h')
     or state in ('signed','sent','unknown')
     or (state='prepared' and created_at > now()-interval '3 minutes' and wallet <> $w) )
```
Returns the single latest unlock time or null. Read-only, no polling, no cron. Compare with `now()` server-side to avoid worker clock skew.

Race safety:
- Today: the module-level single-flight queue serialises prepares in one process, and the row is inserted in `finish` before the next prepare starts, so a second prepare for the same ticker sees the first. Sufficient while there is one worker (the deployed shape, per `prepare.ts` ponytail comment). Add a `ponytail:` comment naming this ceiling.
- Upgrade path when the worker is ever duplicated: a `ticker_locks(key text primary key, launch_id text, until timestamptz)` table; prepare does `insert ... on conflict (key) do update set launch_id=$id, until=$until where ticker_locks.until < now() returning key`, and a zero-row return means refused. Settle sets `until = landed_at + 24h` on landing and deletes the row on failure. This is the DB-enforced version; defer it.
- Do not put the check inside the vanity reserve transaction: it would hold a pool row while checking and mixes two concerns. Checking before reserve is simpler and also avoids reserving a mint for a refused launch.

Hidden and blocked coins:
- Hidden coin (`coins.hidden_at`): keeps holding the lock. Hide is moderation for a bad coin; releasing the lock would let the hidden coin's ticker be relaunched immediately, which is the vamp path. The query ignores `hidden_at` on purpose.
- Blocked wallet: refused earlier with `blocked` (`prepare.ts:143`). Its past landed launches keep their lock until 24h are up.
- Admin override: a Phase 6 console action "release ticker" is optional (extras, rank 5). Without it, the lock is simply 24h and self-clearing; no override is needed for v1.

Refusal code and copy:
- New code `ticker_locked` in `LaunchErrorCode` (`api.ts:22`); worker status 409 in `http.ts`. Extend `ApiError` with `retryAfter?: number` (seconds). Worker computes `until - now()`.
- `FAULTS` (`launch-sign.tsx:42`): the copy needs the hours, so make that entry derive from `retryAfter`, or keep it static if the owner prefers: "Another coin with this ticker launched recently. Nothing was sent. Pick a different ticker or try again later." Dynamic version: "$TICKER launched {n}h ago. It can be used again in {h}h." Round up to whole hours, "under an hour" below 60 min. No emoji. Action: none (user edits the symbol field, so link back to the form step if `FAULTS` supports an action, as `pin_failed` does with "Try again").
- Early hint: the browser cannot know without a read, so do not poll. Show the refusal on the sign step only, and optionally include the rule in the symbol field helper text ("A ticker can be reused 24h after its last launch.").
- Add a line to the terms page (`apps/web/lib/terms.ts`) because the lock is a user-facing rule; one sentence.

Neon budget: one read per prepare, in parallel with five reads that already exist, hitting a small partial index. A refused prepare also costs only that read. No polling anywhere. Prepare volume is capped by `TABLE_CAP` 30/h and `WALLET_TABLE_CAP` 10/day, so worst case is tens of extra reads per hour.

Tests (one runnable check each, matching the repo style):
- `rules.test.ts`: `tickerKey` identity on valid input; `"$pepe "` becomes `PEPE`; fullwidth `ＰＥＰＥ` becomes `PEPE` (NFKC).
- `prepare.test.ts` (existing pure `prepareGuard`/admit harness): landed 1h ago refuses with `retryAfter` about 23h; landed 25h ago allows; failed row allows; hidden coin still refuses; other wallet's fresh `prepared` refuses, own `prepared` allows; two prepares in a row with the same symbol: second refused.
- `launch-sign` FAULTS typecheck (compile-time totality) covers the copy map.

Tradeoffs to state to the owner:
- Griefing: anyone can squat a hot ticker for 24h by launching a dust coin first (cost: create fee plus dev buy minimum, one per 24h per ticker). Wallet cap of 10/day also limits spray. If this bites, switch to the Four.meme model: the lock only starts once the coin has N holders or X SOL volume (needs `coins.holders`, already stored, `schema.ts` `holders`). That is a one-line change to the query's `landed` branch (join `coins`), so build the simple version first and keep the join as the upgrade.
- Cooldown from last launch vs first: extending with each relaunch is impossible (each relaunch is blocked), so it is effectively a fixed window per landing.

## Optional extras, ranked (smallest first)

1. Oldest-first tie-break and "first" marker in search (zero schema): in `lib/coins.ts` when `q` is present, order exact symbol matches by `launched_at asc`; badge the earliest coin with that symbol on cards. Helps users find the original on the 24h-expired relaunches and near-duplicate tickers. Cost: one ORDER BY change, one small UI tag. Search already queries Neon, so no extra reads.
2. Exact image duplicate (one indexed read): `image_cid` is a content hash from Pinata, so same bytes means same CID. Add `CREATE INDEX launches_image_live ON launches (image_cid) WHERE state='landed' AND landed_at > ...` (cannot use `now()` in a partial index predicate; index on `(image_cid, landed_at)` instead). Refuse with the same `ticker_locked`-family code (`copy_locked`?) when a landed coin in 24h used the same image. Trivially evaded by changing one pixel, so low real value; ranked behind 1.
3. Name normalisation match: `nameKey = NFKC, lowercase, strip non-alphanumerics, collapse` and treat equal keys within 24h as a collision, plus store it as a column or use an expression index. Worth doing because `checkName` allows any Unicode, so `Pepe`, `PEPE`, `Рере` (Cyrillic) are different today. Confusables folding needs a table (UTS #39 skeleton) or a small dependency; check that none is installed before adding one. Higher false-positive risk (common words), so refuse only on key match, not fuzzy distance.
4. Reserved tickers for BONDR and top coins: a short static array in `rules.ts` (`BONDR`, `SOL`, `USDC`, `USDT`, `BTC`, `ETH`, `PUMP`, `BONK`, `WIF`). Pure, no DB. Good value for the Phase 7 launch day; also stops impersonating the platform token (D-32 genesis ticker `BONDR`). Not strictly a vamp measure, but the cheapest extra here.
5. Admin override in the Phase 6 console: a "release ticker" action writing an audit row. Only worth it if false positives actually occur; skip for v1.
6. Perceptual image hash (dHash/pHash) plus Hamming distance: needs image decode in the pin route, a new column and a scan or BK-tree; cost and false-positive rate too high for a hobby project. Skip.

## Impossible or out of scope

- Anything launched directly on pump.fun, or on another launchpad, bypasses BONDR entirely. Only the BONDR namespace is protected.
- Near-misses that differ by a character (`PEPE2`, `PEPEE`, `PEPE_`) unless fuzzy matching is added; fuzzy matching on 13-character tickers produces many false refusals.
- Pre-emptive protection of a coin you have not launched on BONDR.

## Open questions for the owner

1. Window: fixed 24h from landing (recommended), or only start the lock after a coin shows traction (holders or volume, Four.meme style) to blunt squatting?
2. May the original creator wallet relaunch its own ticker inside 24h (for example after a mistake)? Default: no exemption.
3. Leet fold (`0` as `O`, `1` as `I`) in the key, yes or no? Default: no.
4. Should hidden coins keep their lock? Default: yes.
5. Add the reserved-ticker list, and who maintains it? Default: yes, static list in code.
6. Include a "first launched" marker and oldest-first search (extras 1)? Default: yes.
7. Copy tone for the refusal: show the exact hours remaining, or a generic line?
