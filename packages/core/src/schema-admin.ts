// Phase 6 admin tables, split from schema.ts by the 300-line rule; schema.ts re-exports them. No import from
// schema.ts: that would be an import cycle, evaluated before schema.ts defines anything.
import { sql } from "drizzle-orm";
import { bigint, check, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const tstz = () => timestamp({ withTimezone: true });
const reason = () => sql`char_length(reason) between 1 and 120`;

// Its own table, not wallets: a deployer can be blocked before it ever consents (D-30).
export const blockedDeployers = pgTable(
  "blocked_deployers",
  {
    wallet: text().primaryKey(),
    reason: text().notNull(),
    createdAt: tstz().notNull().defaultNow(),
  },
  () => [check("blocked_deployers_reason", reason())],
);

// Every admin action, written intent-first by the worker and settled once (D-33). The admin_audit_guard
// trigger in migration 0007 refuses DELETE and any UPDATE but pending to a final result with the identity
// columns unchanged. mint has no foreign key, so dropping a test coin never touches the log.
export const adminAudit = pgTable(
  "admin_audit",
  {
    id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    at: tstz().notNull().defaultNow(),
    actor: text().notNull(),
    action: text().notNull(),
    mint: text(),
    params: jsonb().notNull().default({}),
    simulation: jsonb(), // set together with intent_sig: only money actions are simulated and signed
    intentSig: text(),
    sigs: text().array().notNull().default(sql`'{}'::text[]`),
    result: text().notNull(),
    settledAt: tstz(),
    error: text(),
  },
  (t) => [
    check("admin_audit_result", sql`result in ('pending','landed','failed','refused')`),
    check("admin_audit_settled", sql`(result = 'pending') = (settled_at is null)`),
    check("admin_audit_intent", sql`(intent_sig is null) = (simulation is null)`),
    // Must match AdminAuditAction in api-admin.ts.
    check(
      "admin_audit_action",
      sql`action in ('sweep_now','retry_forced_bond','burn_w_tokens','run_migrate','finalize_split','retry_sweep',
        'distribute_now','sweep_leftovers','burn_buyback','evacuate','hold','release_hold','recheck_launch',
        'switch','hide','unhide','block','unblock')`,
    ),
    index("admin_audit_page").on(t.at.desc(), t.id.desc()),
  ],
);
