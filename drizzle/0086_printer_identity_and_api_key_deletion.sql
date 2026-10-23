-- Accepted Odoo print-job history must outlive a physically deleted API credential.
-- Authentication only checks api_keys; a historical ID never grants access.
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_tenant_id_api_key_id_api_keys_fk;
--> statement-breakpoint
DELETE FROM odoo_installation_credentials WHERE api_key_id IN (
  SELECT id FROM api_keys WHERE hashed_key LIKE 'deleted:%'
);
--> statement-breakpoint
DELETE FROM api_keys WHERE hashed_key LIKE 'deleted:%';
--> statement-breakpoint
-- Do NOT backfill or merge historical printer IDs referenced by print jobs.
-- New endpoint IDs are unique per workspace AND Agent.
ALTER TABLE printers ADD COLUMN IF NOT EXISTS physical_identity_key text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS printers_tenant_agent_physical_identity_unique
  ON printers (tenant_id, agent_id, physical_identity_key)
  WHERE physical_identity_key IS NOT NULL;
