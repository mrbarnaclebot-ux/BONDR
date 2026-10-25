CREATE TABLE "admin_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "admin_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"mint" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"simulation" jsonb,
	"intent_sig" text,
	"sigs" text[] DEFAULT '{}'::text[] NOT NULL,
	"result" text NOT NULL,
	"settled_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "admin_audit_result" CHECK (result in ('pending','landed','failed','refused')),
	CONSTRAINT "admin_audit_settled" CHECK ((result = 'pending') = (settled_at is null)),
	CONSTRAINT "admin_audit_intent" CHECK ((intent_sig is null) = (simulation is null)),
	CONSTRAINT "admin_audit_action" CHECK (action in ('sweep_now','retry_forced_bond','burn_w_tokens','run_migrate','finalize_split','retry_sweep',
        'distribute_now','sweep_leftovers','burn_buyback','evacuate','hold','release_hold','recheck_launch',
        'switch','hide','unhide','block','unblock'))
);
--> statement-breakpoint
CREATE TABLE "blocked_deployers" (
	"wallet" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocked_deployers_reason" CHECK (char_length(reason) between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "fee_ledger" DROP CONSTRAINT "fee_ledger_kind";--> statement-breakpoint
DROP INDEX "fee_ledger_sig_kind";--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "hidden_reason" text;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "held_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "held_reason" text;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "forced_bond_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "sweeps_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "finalize_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "buyback_burn_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "evacuated_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "admin_audit_page" ON "admin_audit" USING btree ("at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_sig_kind" ON "fee_ledger" USING btree ("signature","kind",coalesce(mint, ''));--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_hidden" CHECK ((hidden_at is null) = (hidden_reason is null));--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_held" CHECK ((held_at is null) = (held_reason is null));--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_reasons" CHECK ((hidden_reason is null or char_length(hidden_reason) between 1 and 120)
        and (held_reason is null or char_length(held_reason) between 1 and 120));--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_kind" CHECK (kind in ('collect','split_treasury','sweep_buyback','sweep_treasury','forced_bond','pool_burn',
        'buyback_burn','finalize_config','finalize_update','distribute','held','reconcile_diff','leftover_burn',
        'evacuate'));--> statement-breakpoint
-- Hand-written: drizzle snapshots do not track functions or triggers, so later generates leave these alone.
-- The D-33 transition guard: an audit row is never deleted and changes once, from pending to a final result,
-- with who, what, on which coin, the simulation and the owner's signature unchanged.
CREATE FUNCTION admin_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.result = 'pending' AND NEW.result <> 'pending'
    AND NEW.actor = OLD.actor AND NEW.action = OLD.action AND NEW.at = OLD.at
    AND NEW.mint IS NOT DISTINCT FROM OLD.mint AND NEW.params = OLD.params
    AND NEW.simulation IS NOT DISTINCT FROM OLD.simulation
    AND NEW.intent_sig IS NOT DISTINCT FROM OLD.intent_sig THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'admin_audit rows are append-only: % refused', TG_OP;
END $$;
--> statement-breakpoint
CREATE TRIGGER admin_audit_guard BEFORE UPDATE OR DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION admin_audit_guard();
