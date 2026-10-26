ALTER TABLE "coins" ADD COLUMN "create_slot" bigint;--> statement-breakpoint
ALTER TABLE "coins" ADD COLUMN "sniped_bps" integer;--> statement-breakpoint
CREATE INDEX "launches_symbol_live" ON "launches" USING btree ("symbol","landed_at") WHERE state <> 'failed';--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_sniped_bps" CHECK (sniped_bps is null or sniped_bps between 0 and 10000);--> statement-breakpoint
-- Hand-written, as in 0007: drizzle does not model triggers. Row triggers never fire for TRUNCATE, so the
-- audit log needs a statement trigger too (IN-B-02); admin_audit_guard() raises for any TG_OP but its one
-- allowed UPDATE.
CREATE TRIGGER admin_audit_no_truncate BEFORE TRUNCATE ON admin_audit
  FOR EACH STATEMENT EXECUTE FUNCTION admin_audit_guard();
--> statement-breakpoint
-- Defence in depth only: the owner can re-grant and a superuser bypasses privileges, but the trigger still fires.
REVOKE TRUNCATE ON admin_audit FROM CURRENT_USER;
