CREATE TABLE "consent_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
