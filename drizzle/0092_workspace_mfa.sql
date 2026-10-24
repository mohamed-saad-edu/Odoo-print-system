CREATE TABLE "workspace_mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"credential_version" text NOT NULL,
	"mfa_version" integer NOT NULL,
	"purpose" text NOT NULL,
	"origin" text NOT NULL,
	"session_family_id" text,
	"session_id" text,
	"web_challenge" text,
	"web_operation" text,
	"pending_totp_secret" text,
	"verified_method" text,
	"verified_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_mfa_challenges_purpose_check" CHECK ("workspace_mfa_challenges"."purpose" IN ('login', 'stepup', 'manage', 'recover')),
	CONSTRAINT "workspace_mfa_challenges_scope_check" CHECK ("workspace_mfa_challenges"."kind" IN ('customer','manager') AND (("workspace_mfa_challenges"."purpose" IN ('login','recover') AND "workspace_mfa_challenges"."session_family_id" IS NULL AND "workspace_mfa_challenges"."session_id" IS NULL) OR ("workspace_mfa_challenges"."purpose" IN ('stepup','manage') AND "workspace_mfa_challenges"."session_family_id" IS NOT NULL AND "workspace_mfa_challenges"."session_id" IS NOT NULL))),
	CONSTRAINT "workspace_mfa_challenges_attempts_check" CHECK ("workspace_mfa_challenges"."attempts" >= 0 AND "workspace_mfa_challenges"."attempts" <= 5)
);
--> statement-breakpoint
CREATE TABLE "workspace_mfa_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"public_key" text,
	"encrypted_secret" text,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "workspace_mfa_credentials_kind_check" CHECK (("workspace_mfa_credentials"."kind" = 'webauthn' AND "workspace_mfa_credentials"."public_key" IS NOT NULL AND "workspace_mfa_credentials"."encrypted_secret" IS NULL) OR ("workspace_mfa_credentials"."kind" = 'totp' AND "workspace_mfa_credentials"."encrypted_secret" IS NOT NULL AND "workspace_mfa_credentials"."public_key" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "workspace_mfa_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"tenant_id" text NOT NULL,
	"role" text NOT NULL,
	"credential_version" text NOT NULL,
	"mfa_version" integer NOT NULL,
	"origin" text NOT NULL,
	"purpose" text DEFAULT 'login' NOT NULL,
	"method" text NOT NULL,
	"password_verified_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_mfa_grants_scope_check" CHECK ("workspace_mfa_grants"."kind" IN ('customer','manager') AND "workspace_mfa_grants"."purpose" = 'login'),
	CONSTRAINT "workspace_mfa_grants_method_check" CHECK ("workspace_mfa_grants"."method" IN ('webauthn', 'totp'))
);
--> statement-breakpoint
CREATE TABLE "workspace_mfa_recovery_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "workspace_mfa_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD COLUMN "mfa_version" integer;--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD COLUMN "mfa_method" text;--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD COLUMN "mfa_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_mfa_challenges" ADD CONSTRAINT "workspace_mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mfa_challenges" ADD CONSTRAINT "workspace_mfa_challenges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mfa_credentials" ADD CONSTRAINT "workspace_mfa_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mfa_grants" ADD CONSTRAINT "workspace_mfa_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mfa_grants" ADD CONSTRAINT "workspace_mfa_grants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_mfa_recovery_codes" ADD CONSTRAINT "workspace_mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_mfa_challenges_user_idx" ON "workspace_mfa_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_mfa_challenges_expires_idx" ON "workspace_mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workspace_mfa_credentials_user_idx" ON "workspace_mfa_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_mfa_credentials_totp_idx" ON "workspace_mfa_credentials" USING btree ("user_id") WHERE "workspace_mfa_credentials"."kind" = 'totp' AND "workspace_mfa_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "workspace_mfa_grants_expires_idx" ON "workspace_mfa_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "workspace_mfa_recovery_codes_user_idx" ON "workspace_mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workspace_session_security" ADD CONSTRAINT "workspace_session_security_mfa_check" CHECK (("workspace_session_security"."mfa_version" IS NULL AND "workspace_session_security"."mfa_method" IS NULL AND "workspace_session_security"."mfa_verified_at" IS NULL) OR ("workspace_session_security"."user_id" IS NOT NULL AND "workspace_session_security"."mfa_version" > 0 AND "workspace_session_security"."mfa_method" IN ('webauthn','totp') AND "workspace_session_security"."mfa_verified_at" IS NOT NULL AND "workspace_session_security"."mfa_verified_at" < "workspace_session_security"."expires_at"));
--> statement-breakpoint
-- Mandatory human MFA cutover: historical sessions carry no second-factor proof.
-- Never backfill assurance from a password hash or a token. Preserve factors and
-- platform authority; users sign in and enroll in the independent workspace realm.
UPDATE refresh_tokens SET revoked_at=clock_timestamp(),revoked_reason='workspace_mfa_cutover' WHERE kind IN ('customer','manager') AND user_id IS NOT NULL AND revoked_at IS NULL;
--> statement-breakpoint
UPDATE manager_sessions SET revoked_at=clock_timestamp() WHERE user_id IS NOT NULL AND revoked_at IS NULL;
