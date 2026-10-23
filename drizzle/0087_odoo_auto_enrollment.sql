-- A zero-history Gateway tenant automatically promotes to strict_v2 during
-- first authenticated Odoo enrollment, under FOR UPDATE tenant row lock.
-- Leave the legacy tenant default intact and never rewrite historical receipts.
-- An existing Gateway API key may authenticate more than one Odoo database.
-- Retain the (tenant, installation, api_key) PK and installation FK constraints.
ALTER TABLE "odoo_installation_credentials"
  DROP CONSTRAINT IF EXISTS "odoo_installation_credentials_tenant_id_api_key_id_key";
--> statement-breakpoint
ALTER TABLE "odoo_installation_credentials"
  DROP CONSTRAINT IF EXISTS "odoo_installation_credentials_tenant_key_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "odoo_installation_credentials_tenant_key_unique";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odoo_installation_credentials_tenant_api_key_idx"
  ON "odoo_installation_credentials" ("tenant_id", "api_key_id");
