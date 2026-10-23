-- S06-006: additive, operator-driven installation namespace cutover.
-- Do not migrate, rename, delete or rehash any historical print job or receipt.
ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "odoo_idempotency_mode" text NOT NULL DEFAULT 'legacy';
--> statement-breakpoint
ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_odoo_idempotency_mode_check"
  CHECK (odoo_idempotency_mode IN ('legacy', 'strict_v2'));
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "odoo_installations" (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES "tenants"(id),
  name text NOT NULL,
  secret_hash text NOT NULL,
  enabled boolean NOT NULL DEFAULT TRUE,
  created_at timestamp NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamp,
  UNIQUE (tenant_id, id),
  CHECK (length(secret_hash) = 64)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odoo_installations_tenant_idx" ON "odoo_installations"(tenant_id);
--> statement-breakpoint

-- A credential may be bound to only one enrolled installation. Rotation
-- inserts another association without discarding old evidence.
CREATE TABLE IF NOT EXISTS "odoo_installation_credentials" (
  tenant_id text NOT NULL,
  installation_id text NOT NULL,
  api_key_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, installation_id, api_key_id),
  UNIQUE (tenant_id, api_key_id),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES "odoo_installations"(tenant_id, id),
  FOREIGN KEY (tenant_id, api_key_id)
    REFERENCES "api_keys"(tenant_id, id)
);
--> statement-breakpoint

-- Lifetime namespace record, retained even after payload-free receipts are
-- compacted. One identity cannot be rebound to another operation or install.
CREATE TABLE IF NOT EXISTS "odoo_v2_operations" (
  tenant_id text NOT NULL,
  installation_id text NOT NULL,
  idempotency_key text NOT NULL,
  legacy_key text NOT NULL,
  source_company_id text NOT NULL,
  source_operation_id text NOT NULL,
  accepted_job_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, installation_id, source_company_id, source_operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES "odoo_installations"(tenant_id, id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "odoo_v2_operations_job_idx" ON "odoo_v2_operations"(tenant_id, accepted_job_id);
--> statement-breakpoint

-- Manual, audited disposition of an observed collision. A `reuse` alias
-- must point to exact old immutable job and fingerprint; `distinct` is an
-- explicit human verification that this is another installation's intent.
CREATE TABLE IF NOT EXISTS "odoo_legacy_resolutions" (
  tenant_id text NOT NULL,
  installation_id text NOT NULL,
  idempotency_key text NOT NULL,
  legacy_key text NOT NULL,
  disposition text NOT NULL,
  legacy_job_id text NOT NULL,
  legacy_fingerprint text NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamp NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, installation_id, idempotency_key),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, installation_id)
    REFERENCES "odoo_installations"(tenant_id, id),
  CHECK (disposition IN ('reuse', 'distinct')),
  CHECK (length(legacy_fingerprint) = 64)
);
