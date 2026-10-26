---
phase: 06-admin-dashboard
slice: e2e
reviewed: 2026-10-26T00:00:00Z
depth: quick
files_reviewed: 25
files_reviewed_list:
  - apps/web/e2e/admin-console.e2e.ts
  - apps/web/e2e/admin-devnet.e2e.ts
  - apps/web/e2e/admin-evacuate.e2e.ts
  - apps/web/e2e/admin-inspect.e2e.ts
  - apps/web/e2e/admin-locked.e2e.ts
  - apps/web/e2e/admin-moderation.e2e.ts
  - apps/web/e2e/admin-neon.e2e.ts
  - apps/web/e2e/admin-responsive.e2e.ts
  - apps/web/e2e/admin-signin.e2e.ts
  - apps/web/e2e/admin-sim.e2e.ts
  - apps/web/e2e/admin-stubs.ts
  - apps/web/e2e/admin-switch.e2e.ts
  - apps/web/e2e/admin-timeline.e2e.ts
  - apps/web/e2e/admin-wtable.e2e.ts
  - apps/web/e2e/admin.ts
  - apps/web/e2e/devnet.ts
  - apps/web/e2e/fee-devnet.e2e.ts
  - apps/web/e2e/keys.ts
  - apps/web/e2e/phantom.ts
  - apps/web/e2e/shoot.ts
  - scripts/spike/nets/fork.ts
  - scripts/spike/stages/admin-steps.ts
  - scripts/spike/stages/admin.ts
  - scripts/spike/stages/engine-bond.ts
  - scripts/spike/stages/engine-final.ts
findings:
  critical: 2
  warning: 6
  info: 4
  total: 12
status: issues_found
fix_status: criticals and warnings fixed; IN-E-02, 03, 04 skipped
---

# Phase 6: Code Review Report (slice: e2e specs, helpers, fork spike stage)

**Reviewed:** 2026-10-26
**Depth:** quick (the depth was set to quick, but every file in this slice was read in full and checked against the focus areas: assertions that pass while the feature is broken, devnet spend and shared-state restore, secrets, timing)
**Files Reviewed:** 25
**Status:** issues_found

## Summary

The stubbed admin specs (sim, evacuate, timeline, wtable, inspect, console) are solid. Their routes cannot fall through to a real execute: the client POSTs to `/api/admin/{simulate,execute,intent}` with no query string, so the `stubSim` regex always matches. Signed bytes are checked with `crypto.verify`. No test key or seed reaches logs or the committed `scripts/spike/results/fork.json`. Only addresses, signatures and Neon state are printed.

The problems are in the real-devnet money path spec and in the shared-state cleanup:

- The "Sweep now" proof passes on stale ledger rows.
- The two `E2E_DEVNET=1` specs need opposite worker configurations, yet both run in parallel in the same project.
- Cleanup in several afterAll hooks can be skipped without any failure, or it forces switches on no matter what state they were in before the run.

## Critical Issues

### CR-E-01: "Sweep now collects, splits and sweeps" passes on old ledger rows and never checks this run's rows

**Outcome:** Fixed in 1e35533. Sweep now asserts this run's landed `collect`, `split_treasury` and `sweep_buyback` rows from the DB (`rowsAfter(mark)`, filtered to the coin). The page check is scoped to the sweep's signature. `sweep_treasury` is not required, because sweepJob drops a zero-amount row. Not run: it spends devnet SOL.

**File:** `apps/web/e2e/admin-devnet.e2e.ts:193-202`
**Issue:** The only checks that tie Sweep now to collect, split and sweep are on the token page: `items.filter({ hasText: tag }).first()` for "Collect", "Split 90/10" and "Sweep". The list is newest first and shows every fee movement the coin has ever had. `pickCoin()` returns the newest unique-symbol curve coin with a derived W, which is the same coin that earlier fee-devnet and admin-devnet runs used. On any repeat run the three links already exist before the click, so `toPass` succeeds on its first iteration. `rowsAfter(mark)` (line 193) is only logged and never asserted. Failure scenario: Sweep now lands one transaction that collects but writes no split or sweep rows, or writes them with `state != 'landed'`. The dialog still reads "Sent. 1 of 1 transactions landed.", the audit row reads Landed, the old page rows satisfy the loop, and the test is green.
**Fix:** Assert this run's rows from the DB instead of reading the page. Keep the page check only to confirm the row renders.
```ts
const rows = (await rowsAfter(mark)).filter((r) => r.mint === coin.mint && r.state === "landed");
logRows(rows);
for (const kind of ["collect", "split_treasury", "sweep_buyback", "sweep_treasury"])
  expect(rows.some((r) => r.kind === kind), `${kind} row from this Sweep now`).toBe(true);
// then the page check, scoped to the new signatures:
const sweepSig = rows.find((r) => r.kind === "sweep_buyback")?.signature as string;
await expect(page.getByRole("region", { name: "Fee ledger" }).locator(`a[href*="${sweepSig}"]`)).toHaveCount(1);
```

### CR-E-02: admin-devnet and fee-devnet share one gate, need opposite worker configs, and run in parallel

**Outcome:** Fixed in 1e35533 and ad930e8. admin-devnet is gated on `E2E_DEVNET_ADMIN=1` in its own `devnet-admin` project (dependencies admin-serial, workers 1, ignored by chromium). beforeAll fails if `E2E_DEVNET=1` is also set. To run it alone: `E2E_DEVNET_ADMIN=1 pnpm exec playwright test --project=devnet-admin --no-deps`. Documented in apps/web/e2e/README.md and apps/worker/README.md. fee-devnet keeps `E2E_DEVNET`. Verified that the project skips cleanly without the env.

**File:** `playwright.config.ts:34,46`; `apps/web/e2e/admin-devnet.e2e.ts:2-4,36-37`; `apps/web/e2e/fee-devnet.e2e.ts:1-3,23-24`
**Issue:** Both files skip unless `E2E_DEVNET=1`, and both belong to the `chromium` project with `fullyParallel: true`. `mode: "serial"` only orders tests inside each file, so the two files still run at the same time as each other and as the other `E2E_DEVNET` groups (launch-live, trade, live). Their requirements conflict:
- admin-devnet needs a worker with `FEE_ENGINE=off ADMIN_EVACUATE=on`.
- fee-devnet needs `FEE_ENGINE=on`. With the engine off it waits about 12 minutes and times out. With the engine on, admin-devnet races the engine on the same coin.

Running both also causes these failures:
- Both `pickCoin()` queries can return the same coin.
- EVACUATE drains every derived W to the treasury and pauses all five switches, including `launches`, while fee-devnet waits for a sweep and launch-live is mid-launch.
- Both specs take their "net spend" from the same ops and sim balances, so each counts the other's spend against its own 0.05 SOL cap.

`pnpm e2e` with `E2E_DEVNET=1` reaches this state, and nothing in the config prevents it.
**Fix:** Give each devnet money spec its own gate and project, or put them in a non-parallel project that runs alone:
```ts
// playwright.config.ts
const DEVNET_MONEY = ["**/admin-devnet.e2e.ts", "**/fee-devnet.e2e.ts"];
{ name: "chromium", testIgnore: ["**/paused.e2e.ts", ...ADMIN, ...DEVNET_MONEY], ... },
{ name: "devnet-money", testMatch: DEVNET_MONEY, fullyParallel: false, workers: 1, dependencies: ["admin-serial"] },
```
and gate admin-devnet on `E2E_DEVNET_ADMIN=1` (fee-devnet on `E2E_DEVNET_FEE=1`), so that one run cannot need two worker configurations.

## Warnings

### WR-E-01: "Burn buyback now" skips when the previous test should have filled the buyback

**Outcome:** Fixed in 1e35533. The skip is replaced by expects on VANITY_LANE and on a non-empty buyback.

**File:** `apps/web/e2e/admin-devnet.e2e.ts:205-207`
**Issue:** `test.skip(held === 0n, "buyback empty")`. In this serial file the Sweep now test runs just before and sweeps the buyback share into `buyback:devnet:${VANITY_LANE}`. If the buyback is still empty, the sweep did not deliver the buyback share. That is a failure, but it shows up as a skip. A missing `VANITY_LANE` in the root .env has the same effect: the address is derived from `buyback:devnet:undefined`, it is always empty, and the burn path is never tested. fee-devnet asserts the same precondition (`expect(held).toBeGreaterThan(0n)`, fee-devnet.e2e.ts:132).
**Fix:** `expect(env.VANITY_LANE, "VANITY_LANE in the root .env").toBeTruthy(); expect(held, "the buyback holds the swept BONDR").toBeGreaterThan(0n);`

### WR-E-02: admin-devnet afterAll can skip the restore and forces every switch on whatever its prior state

**Outcome:** Fixed in 1e35533. beforeAll snapshots `settings`. afterAll runs each cleanup on its own (deletes, restore, budget). `restore(snapshot)` checks sign-in and every switch POST, and always writes the snapshot to the DB in `finally`.

**File:** `apps/web/e2e/admin-devnet.e2e.ts:127-146,162-177`
**Issue:**
1. The crafted-row deletes (lines 164-167) sit in the same `try` as `restore()`. If either delete throws (FK, connection drop after a Neon suspend), `restore()` never runs. The shared dev DB then keeps all five switches off and `evacuated_at` set after an EVACUATE, and the run reports only the delete error.
2. `restore()` sets every switch to `true` without recording what it was before the run. If the owner had paused a job on the dev DB on purpose, the spec silently turns it back on.
3. The `/api/admin/switch` responses (line 133) are never checked, and a failed `adminSignIn` is skipped without error. The worker's in-memory switches can stay paused while the DB says on.
**Fix:** Snapshot `settings` in `beforeAll` and restore that snapshot. Run each cleanup independently:
```ts
let before: Record<string, unknown> | undefined; // beforeAll: [before] = await db()`select ... from settings`
test.afterAll(async () => {
  const errors: unknown[] = [];
  const step = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { errors.push(e); } };
  if (crafted.length) await step(() => db()`delete from launches where mint in ${db()(crafted)}`);
  if (crafted.length) await step(() => db()`delete from vanity_mints where pubkey in ${db()(crafted)}`);
  await step(() => restore(before)); // restore() asserts each switch POST is 200 and fails if sign-in fails
  await step(budgetCheck);
  if (errors.length) throw errors[0];
});
```

### WR-E-03: admin-devnet spends devnet SOL before it checks the worker and console configuration it depends on

**Outcome:** Fixed in 1e35533. `preflight()` in beforeAll fails before any spend unless web signs in the test admin (200), health `evacuate` is on and `feeEngine` is not on.

**File:** `apps/web/e2e/admin-devnet.e2e.ts:152-161,179-182,253`; `apps/web/e2e/admin.ts:16-17`
**Issue:** `beforeAll` only checks that `/healthz` answers. If no hand-started worker is running, `playwright.config.ts:63-70` starts one from the root .env (`reuseExistingServer: true`) without `ADMIN_EVACUATE=on`, and possibly with `FEE_ENGINE=on`. The spec then makes two real trades (line 180) before `open()`. On a reused web server without the admin wallet, `openConsole` turns the test into a skip (`not_configured` / `not_admin`) after the SOL is spent. EVACUATE runs `seedW` (a 1 BONDR curve buy, two ATA rents and a transfer) before it learns the deploy is simulate-only and has no "Sign and evacuate" button. In an opted-in money run, a skip also hides the misconfiguration.
**Fix:** In `beforeAll`, sign in on a request context and read health. Fail rather than skip:
```ts
const api = await request.newContext({ baseURL: test.info().project.use.baseURL });
expect((await adminSignIn(api, adminAccount())).status(), "web server has the test ADMIN_WALLET").toBe(200);
const h = await (await api.post("/api/admin/health", { headers: origin(), data: {} })).json();
expect(h.evacuate, "worker started with ADMIN_EVACUATE=on").toBe("on");
expect(h.feeEngine, "worker started with FEE_ENGINE=off").not.toBe("on");
await api.dispose();
```

### WR-E-04: admin-switch and admin-moderation afterAll return silently when sign-in fails, leaving shared state changed

**Outcome:** Fixed in 5b46069. admin-moderation expects the afterAll sign-in to be 200. admin-switch returns only on `not_configured`/`not_admin` (every test was skipped), otherwise expects 200, and adds the DB backstop (`sweeps_enabled`, `finalize_enabled` true). ad930e8 also gives admin-serial `workers: 1`: re-running showed the two files racing on the shared audit log's first row.

**File:** `apps/web/e2e/admin-switch.e2e.ts:25`; `apps/web/e2e/admin-moderation.e2e.ts:22`
**Issue:** `if (!(await adminSignIn(api, admin)).ok()) return;` Sign-in can fail here because of a rate limit, a Neon cold start timeout, or a web server restarted without the admin wallet. When it does, the hook exits without error, so the run can pass while the dev worker and DB keep Sweeps or Finalize paused, or the top coin hidden or a wallet blocked. admin-switch has no DB backstop, unlike admin-devnet's `restore()`.
**Fix:** `expect((await adminSignIn(api, admin)).status(), "afterAll sign-in to undo shared state").toBe(200);`. For admin-switch, also add the same `update settings set sweeps_enabled = true, finalize_enabled = true` DB backstop that admin-devnet uses.

### WR-E-05: The EVACUATE safety check ignores staging coins that are hidden

**Outcome:** Fixed in 1e35533. It now fails closed: after seeding, `fullW()` (every derived dev W with any SOL, BONDR or child token, per evacuateBalances) must equal exactly the seeded W, and the button must read "Sign and evacuate 1 wallet". The public-list skip stays as an extra check. Residual risk: the picked coin itself could be hidden on staging. Not run: it spends devnet SOL.

**File:** `apps/web/e2e/admin-devnet.e2e.ts:93-103,247-252`
**Issue:** The guard that stops EVACUATE from moving staging W funds compares dev mints against staging's public `/api/coins`. The function's own comment says hidden coins are not listed. A coin that is in both the dev and staging DBs and is hidden on staging passes the check. EVACUATE then empties its W (derived from the same `w:devnet:${mint}` seed path) to the treasury and burns its child tokens. These are devnet funds, but they belong to staging's fixtures, which is exactly what the guard is meant to protect.
**Fix:** Make the check fail closed. Compare against an authoritative list that includes hidden coins, for example a staging read-only DB query or an admin endpoint. Or limit EVACUATE's scope to coins whose `launches.wallet` is the dev sim wallet, and assert that every derived W with a balance is in that set before arming.

### WR-E-06: The EVAC fixture's intent expiry is computed when the module loads, so admin-responsive's EVACUATE test can fail on an already-expired intent

**Outcome:** Fixed in 52a6191. `evacFixture()`, `stuck()` (admin-responsive) and `memory()` (admin-timeline) are built per call. The timeline regex accepts `\d{1,2}m` (d2a2405).

**File:** `apps/web/e2e/admin-stubs.ts:131` (used at `apps/web/e2e/admin-responsive.e2e.ts:203,212`)
**Issue:** `EVAC` is a module-level constant with `expiresAt: Date.now() + 600_000`. A Playwright worker process keeps its module cache across test files. If admin-sim or admin-evacuate imports `admin-stubs.ts` in a worker more than 10 minutes before that worker reaches admin-responsive's "EVACUATE disarmed and simulated", the intent has already expired. `useExpiry` (`lib/use-evacuate.ts:84-94`) fires immediately, the ready phase ends, and `expect(... "Sign and evacuate 12 wallets").toBeEnabled()` fails depending on how the scheduler happened to order files. The `at: Date.now() - H` values in admin-timeline.e2e.ts:31 and admin-responsive.e2e.ts:56 have the same pattern. The admin-timeline regex `/1h \dm ago/` at line 112 only accepts a single minute digit.
**Fix:** Build the fixture at call time: `export const evacFixture = () => simFixture({ ..., intent: { id: INTENT_ID, message: "BONDR admin action", expiresAt: Date.now() + 600_000 } });` and call it inside the test. Do the same for the `MEMORY`/`STUCK` timestamps.

## Info

### IN-E-01: The audit-row count in admin-responsive does not retry and depends on dev DB contents

**Outcome:** Fixed in 0dd0bc7. Uses `await expect(...first()).toBeVisible()`. The fresh-branch seed was not added.

**File:** `apps/web/e2e/admin-responsive.e2e.ts:161`
**Issue:** `expect(await audit.locator("tbody tr").count()).toBeGreaterThan(0)` reads the count once, right after the COLL row appears. If the audit section renders later, the test is flaky. On a fresh dev branch with no audit rows it always fails.
**Fix:** `await expect(audit.locator("tbody tr").first()).toBeVisible();`. Seed one audit row if a fresh branch has to pass.

### IN-E-02: The spike's entryOf returns the first matching entry from the whole stage, not from the current action

**Outcome:** Skipped. It touches four call sites in the fork stage and can only be verified by a surfpool fork run. Not one line.

**File:** `scripts/spike/stages/admin-steps.ts:108` (used at `scripts/spike/stages/admin.ts:40,83,102,112`)
**Issue:** `a.settled` grows across all five actions and `find` returns the first entry of a given kind. If an earlier action ever settles an entry of a later action's kind (for example, a closing sweep in `finalize_split` that settles a `distribute` or `leftover_burn`), the later row's `sig`, `burned` and `detail` come from the earlier transaction. Its rule would then judge the wrong transaction. This does not happen in the current fork.json, but nothing prevents it.
**Fix:** Record `const from = a.settled.length` before `act()`, then use `a.settled.slice(from).find(...)`.

### IN-E-03: fee-devnet's ledger wait passes on stale rows and then crashes with a TypeError (existing behavior, file refactored in this phase)

**Outcome:** Skipped. fee-devnet spends devnet SOL and could not be run here. Not one line.

**File:** `apps/web/e2e/fee-devnet.e2e.ts:70-76,110,115-116`
**Issue:** CR-E-01 has the same root cause here. On a reused coin, `waitForLedger` passes immediately, before the window end. Then `rowsAfter(mark)` contains no `sweep_buyback`, and `(undefined as Row).id` throws "Cannot read properties of undefined". The run fails with a confusing error instead of waiting.
**Fix:** Poll the DB (`expect.poll(() => rowsAfter(mark)...some(sweep_buyback))`) with the `until` deadline, then check the page.

### IN-E-04: The 0.05 SOL cap is checked after the spend, and staging traffic on the shared ops wallet distorts the measurement

**Outcome:** Skipped. It is a design choice (report or guard), not a one-line fix.

**File:** `apps/web/e2e/devnet.ts:9`; `apps/web/e2e/admin-devnet.e2e.ts:170-175`
**Issue:** The budget is only `expect`ed in afterAll, so it reports an overspend after the fact. Each `trade()` run has its own cap, but `seedW`, the sweep fees, the burn and EVACUATE have none. The headers note that staging shares the ops wallet. Any staging worker activity during the run changes `ops` and can hide an overspend or cause a false one.
**Fix:** Document it as a report, not a guard, or check `both()` against the remaining budget before each spending step (`seedW`, each dialog send).

---

_Reviewed: 2026-10-26_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: quick_
