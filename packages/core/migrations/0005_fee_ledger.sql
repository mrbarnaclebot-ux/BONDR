CREATE TABLE "fee_ledger" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fee_ledger_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"mint" text,
	"state" text,
	"amount" bigint,
	"burned" bigint,
	"sol" bigint,
	"signature" text,
	"last_valid_block_height" bigint,
	"window_index" integer,
	"ref" bigint,
	"detail" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"landed_at" timestamp with time zone,
	CONSTRAINT "fee_ledger_kind" CHECK (kind in ('collect','split_treasury','sweep_buyback','sweep_treasury','forced_bond','pool_burn',
        'buyback_burn','finalize_config','finalize_update','distribute','held','reconcile_diff')),
	CONSTRAINT "fee_ledger_state" CHECK (state in ('pending','landed','failed','expired')),
	CONSTRAINT "fee_ledger_tx" CHECK ((state is null) = (kind in ('held','reconcile_diff')) and (state is null) = (signature is null)),
	CONSTRAINT "fee_ledger_landed" CHECK ((state = 'landed') = (landed_at is not null)),
	CONSTRAINT "fee_ledger_ref" CHECK ((kind = 'split_treasury') = (ref is not null)),
	CONSTRAINT "fee_ledger_window" CHECK (kind not in ('sweep_buyback','sweep_treasury') or window_index is not null),
	CONSTRAINT "fee_ledger_platform" CHECK ((mint is null) = (kind = 'buyback_burn'))
);
--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "fee_budget" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "fees_unclaimed" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "cost_to_complete" bigint;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "bondr_sol" double precision;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "to_buyback" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "to_buyback_sol" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "to_treasury" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "to_treasury_sol" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "bond_spent" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "bond_spent_sol" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "bond_burned" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "deployer_earned" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "deployer_earned_sol" bigint DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "finalize" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "deployer_bps" smallint;--> statement-breakpoint
ALTER TABLE "fee_ledger" ADD CONSTRAINT "fee_ledger_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_once" ON "fee_ledger" USING btree ("mint","kind") WHERE state in ('pending','landed') and kind in ('forced_bond','pool_burn','finalize_config','finalize_update');--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_bond_burn" ON "fee_ledger" USING btree ("mint") WHERE state in ('pending','landed') and kind in ('forced_bond','pool_burn');--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_sweep" ON "fee_ledger" USING btree ("mint","kind","window_index") WHERE state in ('pending','landed') and kind in ('sweep_buyback','sweep_treasury');--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_split" ON "fee_ledger" USING btree ("ref") WHERE state in ('pending','landed') and kind = 'split_treasury';--> statement-breakpoint
CREATE UNIQUE INDEX "fee_ledger_sig_kind" ON "fee_ledger" USING btree ("signature","kind");--> statement-breakpoint
CREATE INDEX "fee_ledger_public" ON "fee_ledger" USING btree ("mint","landed_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE state = 'landed';--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_finalize" CHECK (finalize in ('none','held','done'));--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_fee_totals" CHECK (fee_budget >= 0 and to_buyback >= 0 and to_buyback_sol >= 0 and to_treasury >= 0 and to_treasury_sol >= 0
        and bond_spent >= 0 and bond_spent_sol >= 0 and bond_burned >= 0 and deployer_earned >= 0
        and deployer_earned_sol >= 0);