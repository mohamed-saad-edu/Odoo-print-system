-- 0109: distinct job cancellation state (WP1, STATIC REVIEW ONLY).
-- Widen the print_jobs status CHECK from the closed v3 set to include
-- 'canceled' (single-l: matches the existing JOB_CANCELED_BY_OPERATOR
-- marker, the v4 brief, and IPP job-state 'canceled'; the discovery
-- sessions table keeps its own 'cancelled' value for a different entity
-- and is NOT touched here). Also widen the receipts CHECK so a canceled
-- job can be archived at retention without a CHECK violation.
--
-- LOCK-SAFE CHECK REPLACEMENT (text CHECK, not an enum: there is no
-- enum ADD VALUE path here): the widened predicate is a superset of the
-- old one, so every existing row already satisfies it.
--   1. ADD the new constraint NOT VALID: no table scan, SHARE ROW
--      EXCLUSIVE lock only, enforced for new/changed rows immediately.
--   2. VALIDATE the new constraint: SHARE UPDATE EXCLUSIVE lock, reads
--      and writes continue while existing rows are scanned.
--   3. DROP the old constraint: metadata-only, but it takes an
--      ACCESS EXCLUSIVE lock, so run this migration with a lock_timeout
--      and off-peak (or admissions-drained, as migration 0102 required).
-- Between steps 1 and 3 the old constraint still blocks inserting
-- 'canceled', so deploy order is: migrate FIRST, deploy the new
-- Gateway code SECOND. The new code must never run against a database
-- where the old CHECK is still present.
ALTER TABLE print_jobs
  ADD CONSTRAINT print_jobs_status_check_v4
  CHECK (status IN ('queued','claimed','printing','success','failed','expired','canceled')) NOT VALID;
--> statement-breakpoint
ALTER TABLE print_jobs VALIDATE CONSTRAINT print_jobs_status_check_v4;
--> statement-breakpoint
ALTER TABLE print_jobs DROP CONSTRAINT print_jobs_status_check;
--> statement-breakpoint
ALTER TABLE print_jobs RENAME CONSTRAINT print_jobs_status_check_v4 TO print_jobs_status_check;
--> statement-breakpoint
ALTER TABLE print_job_receipts
  ADD CONSTRAINT print_job_receipts_status_check_v4
  CHECK (status IN ('success','failed','expired','canceled')) NOT VALID;
--> statement-breakpoint
ALTER TABLE print_job_receipts VALIDATE CONSTRAINT print_job_receipts_status_check_v4;
--> statement-breakpoint
ALTER TABLE print_job_receipts DROP CONSTRAINT print_job_receipts_status_check;
--> statement-breakpoint
ALTER TABLE print_job_receipts RENAME CONSTRAINT print_job_receipts_status_check_v4 TO print_job_receipts_status_check;
--> statement-breakpoint
-- Cancel audit columns. Naming follows the existing print_jobs
-- timestamps (claimed_at, delivered_at, acked_at) and the
-- revoked_reason pattern on tenant_subscriptions: canceled_at holds the
-- DB-clock cancel instant, cancel_reason the operator-supplied reason
-- (bounded to 500 chars by the route; the column itself is free text
-- like error), quota_refunded records whether the admission-month
-- ledger row was actually decremented (queued-never-dispatched cancels
-- only; claimed cancels never refund).
ALTER TABLE print_jobs ADD COLUMN canceled_at timestamp;
--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN cancel_reason text;
--> statement-breakpoint
ALTER TABLE print_jobs ADD COLUMN quota_refunded boolean NOT NULL DEFAULT false;
