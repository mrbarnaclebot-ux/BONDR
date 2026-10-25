// Shared Postgres schema. Integrity lives in constraints (AGENTS.md section 6), so every writer is held to it.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const tstz = () => timestamp({ withTimezone: true });

export const wallets = pgTable("wallets", {
  address: text().primaryKey(),
  consentedAt: tstz().notNull(),
  termsVersion: text().notNull(),
});

// Each consent nonce is spent once, across restarts and replicas (CR-01). Rows past expiry are deleted on the
// next consent, so the table holds at most five minutes of consents.
export const consentNonces = pgTable("consent_nonces", {
  nonce: text().primaryKey(),
  expiresAt: tstz().notNull(),
});

// One row (id 1) so the owner pauses launches with a single UPDATE (LAUNCH-06).
export const settings = pgTable(
  "settings",
  {
    id: integer().primaryKey(),
    launchesEnabled: boolean().notNull().default(true),
  },
  () => [check("settings_single_row", sql`id = 1`)],
);

export const vanityMints = pgTable("vanity_mints", {
  idx: bigint({ mode: "bigint" }).primaryKey(),
  pubkey: text().notNull().unique(),
  reservedBy: text(),
  reservedUntil: tstz(),
  usedAt: tstz(),
});

export const launches = pgTable(
  "launches",
  {
    id: text().primaryKey(),
    wallet: text()
      .notNull()
      .references(() => wallets.address),
    mint: text()
      .notNull()
      .references(() => vanityMints.pubkey),
    w: text().notNull(),
    state: text().notNull(),
    name: text().notNull(),
    symbol: text().notNull(),
    description: text(),
    links: jsonb(),
    imageCid: text(),
    uri: text().notNull(),
    solIn: bigint({ mode: "bigint" }).notNull(),
    exit: text().notNull(),
    lookupTable: text(),
    // Whether this prepare created the lookup table; the worker's hourly table cap counts these.
    newTable: boolean().notNull().default(false),
    message: bytea(),
    blockhash: text(),
    lastValidBlockHeight: bigint({ mode: "bigint" }),
    signedTx: bytea(),
    signature: text().unique(),
    error: text(),
    facts: jsonb(),
    landedAt: tstz(),
    createdAt: tstz().notNull().defaultNow(),
    updatedAt: tstz().notNull().defaultNow(),
  },
  () => [
    check("launches_state", sql`state in ('prepared','signed','sent','landed','failed','unknown')`),
    check("launches_exit", sql`exit in ('burn','sell')`),
    // A mint can be retried after a failure, but only one launch of it may ever land.
    uniqueIndex("launches_landed_mint").on(sql`mint`).where(sql`state = 'landed'`),
    // And only one may be in flight: a second co-signed launch of it could only fail on chain at the dev's cost.
    uniqueIndex("launches_inflight_mint").on(sql`mint`).where(sql`state in ('signed','sent','unknown')`),
  ],
);

// int8 as a decimal string, as postgres-js returns it, so base-unit amounts pass through without BigInt.
const big = customType<{ data: string; driverData: string }>({ dataType: () => "bigint" });
const dbl = () => doublePrecision();

// One row per landed BONDR launch (D-03). Reserves are the curve's; mcap and bond values are SOL at the last
// trade's BONDR price, over a fixed 1B supply (D-22).
export const coins = pgTable(
  "coins",
  {
    mint: text()
      .primaryKey()
      .references(() => vanityMints.pubkey),
    launchId: text()
      .notNull()
      .unique()
      .references(() => launches.id),
    launchedAt: tstz().notNull(),
    bondingCurve: text().notNull(),
    pool: text().notNull(),
    venue: text().notNull().default("curve"),
    initialRealTokenReserves: big().notNull(),
    realTokenReserves: big().notNull(),
    realQuoteReserves: big().notNull(),
    virtualTokenReserves: big().notNull(),
    virtualQuoteReserves: numeric().notNull(),
    mcapSol: dbl().notNull(),
    launchMcapSol: dbl().notNull(),
    progress: dbl().notNull().default(0),
    bondrAtBond: numeric(),
    bondSol: dbl(),
    lastTradeAt: tstz(),
    lastSig: text(),
    lastSlot: big(), // the slot of the trade that set the state above; older trades never move it back
    holders: integer(),
    holdersAt: tstz(),
    bondSig: text(),
    bondedAt: tstz(),
    // Fee engine totals (D-23), base units of BONDR (or the coin for bond_burned) and lamports for *_sol.
    // No window-start column: the window is derived from launched_at and FEE_WINDOW_MS (RESEARCH Pattern 3).
    feeBudget: big().notNull().default("0"),
    feesUnclaimed: big().notNull().default("0"),
    costToComplete: big(),
    bondrSol: dbl(),
    toBuyback: big().notNull().default("0"),
    toBuybackSol: big().notNull().default("0"),
    toTreasury: big().notNull().default("0"),
    toTreasurySol: big().notNull().default("0"),
    bondSpent: big().notNull().default("0"),
    bondSpentSol: big().notNull().default("0"),
    bondBurned: big().notNull().default("0"),
    deployerEarned: big().notNull().default("0"),
    deployerEarnedSol: big().notNull().default("0"),
    finalize: text().notNull().default("none"),
    deployerBps: smallint(),
  },
  (t) => [
    check("coins_venue", sql`venue in ('curve','complete','pool')`),
    check("coins_bonded", sql`(venue = 'curve') = (bonded_at is null)`),
    check("coins_progress", sql`progress between 0 and 1`),
    check("coins_holders", sql`holders >= 0`),
    check("coins_finalize", sql`finalize in ('none','held','done')`),
    check(
      "coins_fee_totals",
      sql`fee_budget >= 0 and to_buyback >= 0 and to_buyback_sol >= 0 and to_treasury >= 0 and to_treasury_sol >= 0
        and bond_spent >= 0 and bond_spent_sol >= 0 and bond_burned >= 0 and deployer_earned >= 0
        and deployer_earned_sol >= 0`,
    ),
    index("coins_launched_at").on(t.launchedAt.desc()),
    index("coins_mcap_sol").on(t.mcapSol.desc()),
  ],
);

// Every fee movement (D-08). A row is inserted pending before anything is signed, so the partial unique
// indexes over live states (pending, landed) make a double sweep, split or burn impossible. Each index is
// partial per kind group because NULLs are distinct in a unique index (RESEARCH Pitfall 1).
const LIVE = sql`state in ('pending','landed')`;
export const feeLedger = pgTable(
  "fee_ledger",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text().notNull(),
    mint: text().references(() => coins.mint), // null only for the platform buyback_burn
    state: text(), // null only for held and reconcile_diff, which have no tx
    amount: big(), // base units of the mint moved (W's |delta| for W txs)
    burned: big(), // tokens burned (coin units; BONDR for buyback_burn)
    sol: big(), // lamports at landing
    signature: text(),
    lastValidBlockHeight: bigint({ mode: "bigint" }),
    windowIndex: integer(),
    ref: bigint({ mode: "number" }), // split_treasury: its collect row id
    detail: jsonb(),
    error: text(),
    createdAt: tstz().notNull().defaultNow(),
    landedAt: tstz(),
  },
  (t) => [
    check(
      "fee_ledger_kind",
      sql`kind in ('collect','split_treasury','sweep_buyback','sweep_treasury','forced_bond','pool_burn',
        'buyback_burn','finalize_config','finalize_update','distribute','held','reconcile_diff')`,
    ),
    check("fee_ledger_state", sql`state in ('pending','landed','failed','expired')`),
    check(
      "fee_ledger_tx",
      sql`(state is null) = (kind in ('held','reconcile_diff')) and (state is null) = (signature is null)`,
    ),
    check("fee_ledger_landed", sql`(state = 'landed') = (landed_at is not null)`),
    check("fee_ledger_ref", sql`(kind = 'split_treasury') = (ref is not null)`),
    check(
      "fee_ledger_window",
      sql`kind not in ('sweep_buyback','sweep_treasury') or window_index is not null`,
    ),
    // A reconcile_diff names its mint, or none for the buyback wallet (D-21).
    check("fee_ledger_platform", sql`kind = 'reconcile_diff' or (mint is null) = (kind = 'buyback_burn')`),
    uniqueIndex("fee_ledger_once")
      .on(t.mint, t.kind)
      .where(sql`${LIVE} and kind in ('forced_bond','pool_burn','finalize_config','finalize_update')`),
    uniqueIndex("fee_ledger_bond_burn")
      .on(t.mint)
      .where(sql`${LIVE} and kind in ('forced_bond','pool_burn')`),
    uniqueIndex("fee_ledger_sweep")
      .on(t.mint, t.kind, t.windowIndex)
      .where(sql`${LIVE} and kind in ('sweep_buyback','sweep_treasury')`),
    uniqueIndex("fee_ledger_split").on(t.ref).where(sql`${LIVE} and kind = 'split_treasury'`),
    uniqueIndex("fee_ledger_sig_kind").on(t.signature, t.kind),
    index("fee_ledger_public").on(t.mint, t.landedAt.desc(), t.id.desc()).where(sql`state = 'landed'`),
  ],
);

// Every trade of a known coin, keyed by (signature, ix) so any replay is a no-op. seq orders trades in a slot.
export const trades = pgTable(
  "trades",
  {
    signature: text().notNull(),
    ix: smallint().notNull(),
    seq: bigint({ mode: "number" }).generatedAlwaysAsIdentity(),
    mint: text()
      .notNull()
      .references(() => coins.mint),
    slot: big().notNull(),
    at: tstz().notNull(),
    side: text().notNull(),
    launch: boolean().notNull().default(false),
    venue: text().notNull(),
    trader: text().notNull(),
    tokenAmount: big().notNull(),
    quoteAmount: big(),
    sol: big(),
    bondrSol: dbl(),
    mcapSol: dbl(),
  },
  (t) => [
    primaryKey({ columns: [t.signature, t.ix] }),
    check("trades_side", sql`side in ('buy','sell','burn')`),
    check("trades_venue", sql`venue in ('curve','pool')`),
    check("trades_token_amount", sql`token_amount > 0`),
    check("trades_burn_sol", sql`(side = 'burn') = (sol is null)`),
    index("trades_mint_slot_seq").on(t.mint, t.slot.desc(), t.seq.desc()),
    index("trades_at").on(t.at),
  ],
);
