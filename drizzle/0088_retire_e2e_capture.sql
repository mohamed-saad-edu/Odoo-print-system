-- Retire the customer-facing E2E capture subsystem completely.
-- It is a simulation queue: no print_jobs, print_job_receipts or
-- billing usage is deleted by this migration.
DROP TABLE IF EXISTS "e2e_capture_runs";
--> statement-breakpoint
-- All NEW workspaces use independent Odoo installation identities by default.
-- Never auto-promote existing legacy tenants or re-key historical print jobs.
ALTER TABLE "tenants" ALTER COLUMN "odoo_idempotency_mode" SET DEFAULT 'strict_v2';
