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
--> statement-breakpoint
-- Constrain new or reassigned job credentials while allowing historical jobs
-- to retain an identifier once that credential has been physically erased.
-- FOR KEY SHARE serializes with concurrent DELETE of a key record.
CREATE FUNCTION validate_print_job_api_key_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.api_key_id IS NOT NULL THEN
    PERFORM 1 FROM api_keys
      WHERE tenant_id = NEW.tenant_id AND id = NEW.api_key_id FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'API key must belong to the job workspace'
        USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER print_jobs_api_key_tenant_insert_guard
  BEFORE INSERT OR UPDATE OF api_key_id, tenant_id ON print_jobs
  FOR EACH ROW EXECUTE FUNCTION validate_print_job_api_key_tenant();
