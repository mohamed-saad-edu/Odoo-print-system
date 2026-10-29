-- 0103: preserve non-secret spooler/attempt correlations when terminal jobs
-- are archived. Existing payload-free receipts have no reconstructable event
-- history because job_events cascaded on deletion; historical values stay NULL.
-- Additive and backward-compatible with older Gateway/Agent installations.
ALTER TABLE "print_job_receipts" ADD COLUMN IF NOT EXISTS "spooler_job_id" text;
--> statement-breakpoint
ALTER TABLE "print_job_receipts" ADD COLUMN IF NOT EXISTS "attempt_id" text;
