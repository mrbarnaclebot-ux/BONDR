CREATE TABLE "launches" (
	"id" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"mint" text NOT NULL,
	"w" text NOT NULL,
	"state" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text,
	"links" jsonb,
	"image_cid" text,
	"uri" text NOT NULL,
	"sol_in" bigint NOT NULL,
	"exit" text NOT NULL,
	"lookup_table" text,
	"new_table" boolean DEFAULT false NOT NULL,
	"message" "bytea",
	"blockhash" text,
	"last_valid_block_height" bigint,
	"signed_tx" "bytea",
	"signature" text,
	"error" text,
	"facts" jsonb,
	"landed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "launches_signature_unique" UNIQUE("signature"),
	CONSTRAINT "launches_state" CHECK (state in ('prepared','signed','sent','landed','failed','unknown')),
	CONSTRAINT "launches_exit" CHECK (exit in ('burn','sell'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"launches_enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "settings_single_row" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "vanity_mints" (
	"idx" bigint PRIMARY KEY NOT NULL,
	"pubkey" text NOT NULL,
	"reserved_by" text,
	"reserved_until" timestamp with time zone,
	"used_at" timestamp with time zone,
	CONSTRAINT "vanity_mints_pubkey_unique" UNIQUE("pubkey")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"terms_version" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_wallet_wallets_address_fk" FOREIGN KEY ("wallet") REFERENCES "public"."wallets"("address") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "launches" ADD CONSTRAINT "launches_mint_vanity_mints_pubkey_fk" FOREIGN KEY ("mint") REFERENCES "public"."vanity_mints"("pubkey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "launches_landed_mint" ON "launches" USING btree (mint) WHERE state = 'landed';--> statement-breakpoint
INSERT INTO "settings" ("id", "launches_enabled") VALUES (1, true) ON CONFLICT DO NOTHING;