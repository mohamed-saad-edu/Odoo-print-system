CREATE TABLE "platform_mfa_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_version" text NOT NULL,
	"mfa_version" integer NOT NULL,
	"purpose" text NOT NULL,
	"origin" text NOT NULL,
	"session_family_id" text,
	"web_challenge" text,
	"web_operation" text,
	"pending_totp_secret" text,
	"verified_method" text,
	"verified_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_mfa_challenges_purpose_check" CHECK ("platform_mfa_challenges"."purpose" IN ('login', 'manage', 'recover')),
	CONSTRAINT "platform_mfa_challenges_attempts_check" CHECK ("platform_mfa_challenges"."attempts" >= 0 AND "platform_mfa_challenges"."attempts" <= 5)
);
--> statement-breakpoint
CREATE TABLE "platform_mfa_credentials" (
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
	CONSTRAINT "platform_mfa_credentials_kind_check" CHECK (("platform_mfa_credentials"."kind" = 'webauthn' AND "platform_mfa_credentials"."public_key" IS NOT NULL AND "platform_mfa_credentials"."encrypted_secret" IS NULL) OR ("platform_mfa_credentials"."kind" = 'totp' AND "platform_mfa_credentials"."encrypted_secret" IS NOT NULL AND "platform_mfa_credentials"."public_key" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "platform_mfa_grants" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_version" text NOT NULL,
	"mfa_version" integer NOT NULL,
	"method" text NOT NULL,
	"password_verified_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_mfa_grants_method_check" CHECK ("platform_mfa_grants"."method" IN ('webauthn', 'totp'))
);
--> statement-breakpoint
CREATE TABLE "platform_mfa_recovery_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "platform_session_security" (
	"family_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mfa_version" integer NOT NULL,
	"method" text NOT NULL,
	"verified_at" timestamp NOT NULL,
	"password_verified_at" timestamp NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	CONSTRAINT "platform_session_security_method_check" CHECK ("platform_session_security"."method" IN ('webauthn', 'totp'))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "platform_mfa_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_mfa_challenges" ADD CONSTRAINT "platform_mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mfa_credentials" ADD CONSTRAINT "platform_mfa_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mfa_grants" ADD CONSTRAINT "platform_mfa_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_mfa_recovery_codes" ADD CONSTRAINT "platform_mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_session_security" ADD CONSTRAINT "platform_session_security_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_mfa_challenges_user_idx" ON "platform_mfa_challenges" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_mfa_challenges_expires_idx" ON "platform_mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "platform_mfa_credentials_user_idx" ON "platform_mfa_credentials" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_mfa_credentials_totp_idx" ON "platform_mfa_credentials" USING btree ("user_id") WHERE "platform_mfa_credentials"."kind" = 'totp' AND "platform_mfa_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "platform_mfa_grants_expires_idx" ON "platform_mfa_grants" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "platform_mfa_recovery_codes_user_idx" ON "platform_mfa_recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_session_security_user_idx" ON "platform_session_security" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "platform_session_security_expires_idx" ON "platform_session_security" USING btree ("expires_at");