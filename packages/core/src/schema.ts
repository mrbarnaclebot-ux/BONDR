// Shared Postgres schema. Integrity lives in constraints (AGENTS.md section 6), so every writer is held to it.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  integer,
  jsonb,
  pgTable,
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
