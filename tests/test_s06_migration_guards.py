"""Migration contract guards for safe staged rollout; does not replace native PostgreSQL tests."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "drizzle/0085_odoo_installation_idempotency.sql"


def test_forward_migration_is_additive_and_does_not_touch_historical_jobs_or_receipts():
    sql = SQL.read_text()
    assert 'CREATE TABLE IF NOT EXISTS "odoo_installations"' in sql
    assert 'CREATE TABLE IF NOT EXISTS "odoo_v2_operations"' in sql
    assert 'CREATE TABLE IF NOT EXISTS "odoo_legacy_resolutions"' in sql
    assert 'CREATE TABLE IF NOT EXISTS "odoo_installation_credentials"' in sql
    assert 'odoo_idempotency_mode' in sql
    assert 'DEFAULT \'legacy\'' in sql
    assert 'DROP TABLE' not in sql
    assert 'DELETE FROM print_jobs' not in sql
    assert 'DELETE FROM print_job_receipts' not in sql
    assert 'UPDATE print_jobs' not in sql
    assert 'UPDATE print_job_receipts' not in sql


def test_new_versions_and_aliases_have_database_level_uniqueness():
    sql = SQL.read_text()
    assert 'UNIQUE (tenant_id, idempotency_key)' in sql
    assert 'UNIQUE (tenant_id, api_key_id)' in sql
    assert 'CHECK (disposition IN (\'reuse\', \'distinct\'))' in sql
    assert 'REFERENCES "tenants"' in sql


def test_forward_migration_registered_in_immutable_drizzle_journal():
    import json
    doc = json.loads((ROOT / "drizzle/meta/_journal.json").read_text())
    tags = [row["tag"] for row in doc["entries"]]
    assert tags[-5] == "0085_odoo_installation_idempotency"
    assert tags[-4] == "0086_printer_identity_and_api_key_deletion"
    assert tags[-3] == "0087_odoo_auto_enrollment"
    assert tags[-2] == "0088_retire_e2e_capture"
    assert tags[-1] == "0089_invitation_verification_binding"
    assert len(tags) == len(list((ROOT / "drizzle").glob("*.sql")))
    assert tags == [p.stem for p in sorted((ROOT / "drizzle").glob("*.sql"))]
    assert len(tags) == 90


def test_rotation_preserves_installation_ownership():
    source = (ROOT / "src/app/api/odoo/keys/[id]/rotate/route.ts").read_text()
    assert "INSERT INTO odoo_installation_credentials" in source
    assert "SELECT tenant_id, installation_id" in source
    assert "api_key_id" in source


def test_reuse_approval_immediately_maps_receipt_without_second_post():
    source = (ROOT / "src/app/api/odoo/installations/resolutions/route.ts").read_text()
    assert "INSERT INTO odoo_v2_operations" in source
    assert 'disposition === "reuse"' in source
    assert "found.id" in source


def test_auto_cutover_is_history_fenced_and_api_keys_can_be_shared():
    migration = (ROOT / "drizzle/0087_odoo_auto_enrollment.sql").read_text()
    schema = (ROOT / "src/db/schema.ts").read_text()
    endpoint = (ROOT / "src/app/api/odoo/installations/auto/route.ts").read_text()
    assert "SET DEFAULT 'strict_v2'" not in migration
    assert "FROM print_jobs" in endpoint and "FROM print_job_receipts" in endpoint
    assert "FOR UPDATE" in endpoint
    assert "UPDATE tenants SET odoo_idempotency_mode = 'strict_v2'" in endpoint
    assert "DROP CONSTRAINT IF EXISTS" in migration
    assert "CREATE INDEX IF NOT EXISTS" in migration
    assert 'odooIdempotencyMode: text("odoo_idempotency_mode").notNull().default("strict_v2")' in schema
    retirement = (ROOT / "drizzle/0088_retire_e2e_capture.sql").read_text()
    assert "DROP TABLE IF EXISTS" in retirement
    assert "SET DEFAULT 'strict_v2'" in retirement
    assert 'odoo_installation_credentials_tenant_api_key_idx' in schema
