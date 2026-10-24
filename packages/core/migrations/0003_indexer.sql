CREATE TABLE "coins" (
	"mint" text PRIMARY KEY NOT NULL,
	"launch_id" text NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"bonding_curve" text NOT NULL,
	"pool" text NOT NULL,
	"venue" text DEFAULT 'curve' NOT NULL,
	"initial_real_token_reserves" bigint NOT NULL,
	"real_token_reserves" bigint NOT NULL,
	"real_quote_reserves" bigint NOT NULL,
	"virtual_token_reserves" bigint NOT NULL,
	"virtual_quote_reserves" numeric NOT NULL,
	"mcap_sol" double precision NOT NULL,
	"launch_mcap_sol" double precision NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"bondr_at_bond" numeric,
	"bond_sol" double precision,
	"last_trade_at" timestamp with time zone,
	"last_sig" text,
	"holders" integer,
	"holders_at" timestamp with time zone,
	"bond_sig" text,
	"bonded_at" timestamp with time zone,
	CONSTRAINT "coins_launchId_unique" UNIQUE("launch_id"),
	CONSTRAINT "coins_venue" CHECK (venue in ('curve','complete','pool')),
	CONSTRAINT "coins_bonded" CHECK ((venue = 'curve') = (bonded_at is null)),
	CONSTRAINT "coins_progress" CHECK (progress between 0 and 1),
	CONSTRAINT "coins_holders" CHECK (holders >= 0)
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"signature" text NOT NULL,
	"ix" smallint NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "trades_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"mint" text NOT NULL,
	"slot" bigint NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"side" text NOT NULL,
	"launch" boolean DEFAULT false NOT NULL,
	"venue" text NOT NULL,
	"trader" text NOT NULL,
	"token_amount" bigint NOT NULL,
	"quote_amount" bigint,
	"sol" bigint,
	"bondr_sol" double precision,
	"mcap_sol" double precision,
	CONSTRAINT "trades_signature_ix_pk" PRIMARY KEY("signature","ix"),
	CONSTRAINT "trades_side" CHECK (side in ('buy','sell','burn')),
	CONSTRAINT "trades_venue" CHECK (venue in ('curve','pool')),
	CONSTRAINT "trades_token_amount" CHECK (token_amount > 0),
	CONSTRAINT "trades_burn_sol" CHECK ((side = 'burn') = (sol is null))
);
--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_mint_vanity_mints_pubkey_fk" FOREIGN KEY ("mint") REFERENCES "public"."vanity_mints"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_launch_id_launches_id_fk" FOREIGN KEY ("launch_id") REFERENCES "public"."launches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coins_launched_at" ON "coins" USING btree ("launched_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "coins_mcap_sol" ON "coins" USING btree ("mcap_sol" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_mint_slot_seq" ON "trades" USING btree ("mint","slot" DESC NULLS LAST,"seq" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_at" ON "trades" USING btree ("at");