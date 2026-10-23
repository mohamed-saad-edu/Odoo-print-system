-- The new-product default: no customer Cutover step for NEW Gateway workspaces.
-- Existing tenant rows remain untouched; historical v1 receipts never change.
ALTER TABLE "tenants" ALTER COLUMN "odoo_idempotency_mode" SET DEFAULT 'strict_v2';
--> statement-breakpoint
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
