-- 0108: make subscription revocation terminal for the current contract (v3).
-- Forward-only, backward-compatible: two new nullable columns, no backfill.
-- Before this migration, revoke and suspend were identical (status only),
-- so a revoked tenant could be reactivated within its term. After it,
-- revoke sets revoked_at/revoked_reason (src/lib/manual-subscriptions.ts)
-- and reactivate/extend reject revoked rows with SUBSCRIPTION_REVOKED.
-- Rows revoked before 0108 keep revoked_at NULL and retain the old
-- reactivatable behaviour; only new revokes are terminal. A platform owner
-- can still issue a brand-new contract via save/renew, which clears the
-- marker. Suspension already blocks entitlement, so no ledger change here.
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "revoked_at" timestamp;
--> statement-breakpoint
ALTER TABLE "tenant_subscriptions" ADD COLUMN IF NOT EXISTS "revoked_reason" text;
