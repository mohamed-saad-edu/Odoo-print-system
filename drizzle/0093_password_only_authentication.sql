-- V3 password-only authentication. Historical migrations remain immutable.
-- Run with the application stopped and the normal transactional migration
-- runner. Accounts, password hashes, memberships, audit history, refresh
-- tokens, session families and all existing session deadlines are preserved.
-- Only obsolete factor material and its assurance columns are removed.
-- No CASCADE is used: an unexpected dependent object aborts the transaction.
ALTER TABLE "platform_session_security" ADD COLUMN "password_version" text;--> statement-breakpoint
-- PostgreSQL core sha256(bytea) needs no extension or application signing key.
-- Bind every retained policy row to its account's current salted verifier.
UPDATE "platform_session_security" AS s SET "password_version"=encode(sha256(convert_to(u."password_hash",'UTF8')),'hex')
FROM "users" AS u WHERE u."id"=s."user_id";--> statement-breakpoint
ALTER TABLE "platform_session_security" ALTER COLUMN "password_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_session_security" ADD CONSTRAINT "platform_session_security_password_version_check" CHECK ("password_version" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "workspace_session_security" DROP CONSTRAINT "workspace_session_security_mfa_check";--> statement-breakpoint
ALTER TABLE "platform_session_security" DROP CONSTRAINT "platform_session_security_method_check";--> statement-breakpoint
ALTER TABLE "workspace_session_security" DROP COLUMN "mfa_version", DROP COLUMN "mfa_method", DROP COLUMN "mfa_verified_at";--> statement-breakpoint
ALTER TABLE "platform_session_security" DROP COLUMN "mfa_version", DROP COLUMN "method", DROP COLUMN "verified_at";--> statement-breakpoint
DROP TABLE "workspace_mfa_challenges";--> statement-breakpoint
DROP TABLE "workspace_mfa_grants";--> statement-breakpoint
DROP TABLE "workspace_mfa_recovery_codes";--> statement-breakpoint
DROP TABLE "workspace_mfa_credentials";--> statement-breakpoint
DROP TABLE "platform_mfa_challenges";--> statement-breakpoint
DROP TABLE "platform_mfa_grants";--> statement-breakpoint
DROP TABLE "platform_mfa_recovery_codes";--> statement-breakpoint
DROP TABLE "platform_mfa_credentials";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "platform_mfa_version", DROP COLUMN "workspace_mfa_version";
