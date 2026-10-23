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
    holders: integer(),
    holdersAt: tstz(),
    bondSig: text(),
    bondedAt: tstz(),
  },
  (t) => [
    check("coins_venue", sql`venue in ('curve','complete','pool')`),
    check("coins_bonded", sql`(venue = 'curve') = (bonded_at is null)`),
    check("coins_progress", sql`progress between 0 and 1`),
    check("coins_holders", sql`holders >= 0`),
    index("coins_launched_at").on(t.launchedAt.desc()),
    index("coins_mcap_sol").on(t.mcapSol.desc()),
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
