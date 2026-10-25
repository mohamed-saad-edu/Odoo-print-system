CREATE TABLE "workspace_session_security" (
	"family_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" text NOT NULL,
	"user_id" text,
	"credential_version" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"password_verified_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "workspace_session_security_scope_check" CHECK (("workspace_session_security"."kind" = 'customer' AND "workspace_session_security"."user_id" IS NOT NULL) OR "workspace_session_security"."kind" = 'manager'),
	CONSTRAINT "workspace_session_security_proof_check" CHECK ("workspace_session_security"."credential_version" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workspace_session_security_time_check" CHECK ("workspace_session_security"."created_at" <= "workspace_session_security"."password_verified_at" AND "workspace_session_security"."created_at" <= "workspace_session_security"."last_seen_at" AND "workspace_session_security"."password_verified_at" < "workspace_session_security"."expires_at" AND "workspace_session_security"."last_seen_at" < "workspace_session_security"."expires_at")
);
--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD CONSTRAINT "workspace_session_security_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD CONSTRAINT "workspace_session_security_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_session_security_user_idx" ON "workspace_session_security" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_session_security_tenant_idx" ON "workspace_session_security" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "workspace_session_security_expires_idx" ON "workspace_session_security" USING btree ("expires_at");
--> statement-breakpoint
-- No old token proves when a password was verified or a person was active.
-- Require a fresh sign-in at this forward-only security cutover.
UPDATE refresh_tokens SET revoked_at=clock_timestamp(), revoked_reason='workspace_security_cutover'
WHERE kind IN ('customer','manager') AND revoked_at IS NULL;
--> statement-breakpoint
UPDATE manager_sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
