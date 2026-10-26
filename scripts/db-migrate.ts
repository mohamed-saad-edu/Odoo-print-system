import { readMigrationFiles } from "drizzle-orm/migrator";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PoolClient } from "pg";
import { runtimeSecret } from "../src/lib/runtime-secret";


// Retained forward repairs supplement the immutable SQL migration journal.
// Append versioned entries; never edit historical SQL/hash identities.
export const AUDIT_REPAIRS: readonly string[] = [
  `-- audit A98 v1: preserve catalog price identities used by existing subscriptions
ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_history text[] NOT NULL DEFAULT ARRAY[]::text[];
UPDATE plans SET stripe_price_history = ARRAY[stripe_price_id] WHERE stripe_price_id IS NOT NULL AND stripe_price_history = ARRAY[]::text[];`,
  `-- audit A96 v1: fence fetched Stripe snapshots across concurrent commits
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS stripe_state_revision bigint NOT NULL DEFAULT 0;`,
  `-- audit A97 v1: immutable Stripe checkout request snapshot
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS checkout_request_params jsonb;`,
  `-- audit A97 v2: bound recovery below Stripe idempotency retention
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS checkout_intent_created_at timestamp;`,
  `-- audit A62 v1: closed attempt acknowledgement evidence
ALTER TABLE print_jobs ADD COLUMN IF NOT EXISTS closed_claim_token_hash text;`,
  `-- audit A158 v1: reject absent/null payload discriminators on all new writes
ALTER TABLE print_jobs DROP CONSTRAINT IF EXISTS print_jobs_payload_contract_check;
ALTER TABLE print_jobs ADD CONSTRAINT print_jobs_payload_contract_check CHECK (
  jsonb_typeof(payload) = 'object' AND (
    (COALESCE(payload->>'type', '') = 'raw' AND COALESCE(payload->>'protocol', '') IN ('raw','escpos','zpl','tspl'))
    OR (COALESCE(payload->>'type', '') = 'escpos' AND COALESCE(payload->>'protocol', '') = 'escpos')
    OR (COALESCE(payload->>'type', '') = 'pdf' AND COALESCE(payload->>'protocol', '') = '')
    OR (COALESCE(payload->>'type', '') = 'image' AND COALESCE(payload->>'protocol', '') = '')
  )
) NOT VALID;`,
  `-- audit A86 v1: retain payload-free completion and idempotency evidence
CREATE TABLE IF NOT EXISTS print_job_receipts (
 id text PRIMARY KEY, tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 idempotency_key text, fingerprint text NOT NULL, printer_id text NOT NULL, agent_id text NOT NULL,
 api_key_id text, destination text, document_type text, requested_by text NOT NULL,
 status text NOT NULL CHECK (status IN ('success','failed','expired')), error text, closed_claim_token_hash text,
 delivered_at timestamp, acked_at timestamp, created_at timestamp NOT NULL, updated_at timestamp NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS print_job_receipts_tenant_idempotency_unique ON print_job_receipts(tenant_id,idempotency_key);`,
  `-- audit A86 v2: preserve nullable historical requester metadata
ALTER TABLE print_job_receipts ALTER COLUMN requested_by DROP NOT NULL;`,
];

/** Scope legacy name-only guards without changing stored migration SQL/hashes. */
export function scopeMigrationConstraintGuards(statement: string): string {
  return statement.replaceAll(
    /FROM pg_constraint WHERE conname =/g,
    "FROM pg_constraint WHERE connamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()) AND conname =",
  );
}

// 0019 admitted plain Odoo destination labels. Immutable 0020 only resolves
// lookup IDs before dropping that column. Bridge the unmatched labels inside
// the same migration transaction, without changing its recorded SQL hash.
const LEGACY_DESTINATION_REMOVAL_HASH = "8dfc2b9d31edb9b0d05d81fe7a7bc0105f34c9640825f49658cc4e3128d74c2d";
async function preserveLegacyDestinationLabels(client: PoolClient): Promise<void> {
  await client.query(`DO $destination_labels$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'print_jobs' AND column_name = 'destination_id') THEN
    ALTER TABLE public.print_jobs ADD COLUMN IF NOT EXISTS destination text;
    IF to_regclass('public.destinations') IS NOT NULL THEN
      UPDATE public.print_jobs j SET destination = j.destination_id
      WHERE j.destination IS NULL AND j.destination_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.destinations d WHERE d.id = j.destination_id);
    ELSE
      UPDATE public.print_jobs SET destination = destination_id
      WHERE destination IS NULL AND destination_id IS NOT NULL;
    END IF;
  END IF;
END $destination_labels$;`);
}

// Immutable0081 identifies the victims in its first temporary-table statement.
// Preserve exact row snapshots before its deletes and cascades remove evidence.
const PHYSICAL_ONLY_CUTOVER_HASH = "9a432a7ddb1816649961a309fadaf12dedb054f7edd7b047addd6c03de798410";
async function preserveLegacyPrintHistory(client: PoolClient): Promise<void> {
  await client.query("CREATE SCHEMA IF NOT EXISTS legacy_printing; REVOKE ALL ON SCHEMA legacy_printing FROM PUBLIC");
  const sources = [
    ["printers", "r.id", "NULL::text", "JOIN _removed_virtual_printers v ON v.tenant_id=r.tenant_id AND v.id=r.id"],
    ["print_jobs", "r.printer_id", "r.id", "JOIN _removed_virtual_printers v ON v.tenant_id=r.tenant_id AND v.id=r.printer_id"],
    ["job_events", "j.printer_id", "r.job_id", "JOIN print_jobs j ON j.tenant_id=r.tenant_id AND j.id=r.job_id JOIN _removed_virtual_printers v ON v.tenant_id=j.tenant_id AND v.id=j.printer_id"],
    ["print_job_receipts", "r.printer_id", "r.id", "JOIN _removed_virtual_printers v ON v.tenant_id=r.tenant_id AND v.id=r.printer_id"],
    ["discovered_devices", "r.provisioned_printer_id", "NULL::text", `WHERE EXISTS (SELECT 1 FROM _removed_virtual_printers v WHERE v.tenant_id=r.tenant_id AND v.id=r.provisioned_printer_id)
      OR lower(COALESCE(r.spooler_name,r.device_name,'')) ~ '(microsoft print to pdf|onenote|xps document writer|pdf24|pdfcreator|virtual printer|print to pdf|remote desktop easy print|redirected)'
      OR r.capabilities @> '{"virtual": true}'::jsonb OR r.capabilities @> '{"is_virtual": true}'::jsonb
      OR lower(COALESCE(r.capabilities->>'printer_class','')) IN ('virtual','redirected')
      OR lower(COALESCE(r.capabilities->>'port_name','')) ~ '^(portprompt:|xpsport:|file:|nul:|null:|shrfax:|fax:)'`],
  ];
  // All interpolated identifiers/projections are fixed owner code, never input.
  for (const [table, printer, job, scope] of sources) {
    if (!(await client.query("SELECT to_regclass($1) AS relation", [table])).rows[0].relation) continue;
    await client.query(`CREATE TABLE IF NOT EXISTS legacy_printing.${table} (
      tenant_id text NOT NULL, entity_id text NOT NULL, printer_id text, job_id text,
      record jsonb NOT NULL, archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY(tenant_id,entity_id)
    );
    REVOKE ALL ON TABLE legacy_printing.${table} FROM PUBLIC;
    INSERT INTO legacy_printing.${table}(tenant_id,entity_id,printer_id,job_id,record)
      SELECT r.tenant_id,r.id,${printer},${job},to_jsonb(r) FROM ${table} r ${scope}
      ON CONFLICT(tenant_id,entity_id) DO NOTHING`);
  }
}

/** Complete provider evidence before immutable0098 drops the old columns. */
async function preserveLegacyProviderBilling(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS legacy_billing;
    REVOKE ALL ON SCHEMA legacy_billing FROM PUBLIC;
    CREATE TABLE IF NOT EXISTS legacy_billing.plan_provider_history (
      plan_id text PRIMARY KEY, provider_metadata jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS legacy_billing.subscription_provider_history (
      tenant_id text PRIMARY KEY, provider_metadata jsonb NOT NULL,
      archived_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    INSERT INTO legacy_billing.plan_provider_history AS history (plan_id, provider_metadata)
    SELECT p.id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(p))
      WHERE key IN ('stripe_price_id','stripe_price_history','stripe_product_id','currency','interval'))
    FROM plans p
    ON CONFLICT(plan_id) DO UPDATE SET provider_metadata=history.provider_metadata || EXCLUDED.provider_metadata;
    INSERT INTO legacy_billing.subscription_provider_history AS history (tenant_id, provider_metadata)
    SELECT s.tenant_id, (SELECT jsonb_object_agg(key,value) FROM jsonb_each(to_jsonb(s))
      WHERE key IN ('stripe_customer_id','stripe_subscription_id','billing_mode','trial_started_at',
        'stripe_last_event_created_at','stripe_state_revision','checkout_status','checkout_plan_id',
        'checkout_idempotency_key','checkout_request_params','checkout_intent_created_at',
        'checkout_session_id','checkout_session_url','checkout_session_expires_at',
        'billing_operation_id','billing_operation_type','billing_operation_idempotency_key',
        'billing_operation_subscription_id'))
    FROM tenant_subscriptions s
    ON CONFLICT(tenant_id) DO UPDATE SET provider_metadata=history.provider_metadata || EXCLUDED.provider_metadata;
  `);
}

/** Apply journal order by recorded content hash, including skipped older timestamps. */
export async function migrateByHash(client: PoolClient, migrationsFolder: string): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder });
  // Immutable legacy repair hashes remain recorded for migration-ledger parity.
  // Once the manual-only cutover is present, do not re-create retired provider
  // columns after the forward-only cleanup migration drops them.
  const manualOnly = migrations.some(m => m.sql.some(statement => statement.includes("PROVIDER_BILLING_RETIREMENT_V1")));
  await client.query("BEGIN");
  try {
    // Historical DDL explicitly references public; keep unqualified tables and
    // catalog guards in that same target instead of an inherited search path.
    await client.query("SET LOCAL search_path TO public");
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database() || ':' || current_schema() || ':migrations'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
    const history = await client.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations');
    const applied = new Set(history.rows.map(row => row.hash));
    for (const migration of migrations) {
      if (applied.has(migration.hash)) continue;
      if (migration.hash === LEGACY_DESTINATION_REMOVAL_HASH) await preserveLegacyDestinationLabels(client);
      if (migration.sql.some(statement => statement.includes("PROVIDER_BILLING_RETIREMENT_V1"))) await preserveLegacyProviderBilling(client);
      const preservePrintHistory = migration.hash === PHYSICAL_ONLY_CUTOVER_HASH;
      if (preservePrintHistory) {
        // Prevent writes between selecting victims, archiving and deleting them.
        await client.query("LOCK TABLE printers, print_jobs, job_events, discovered_devices IN SHARE ROW EXCLUSIVE MODE");
        if ((await client.query("SELECT to_regclass('print_job_receipts') AS relation")).rows[0].relation) {
          await client.query("LOCK TABLE print_job_receipts IN SHARE ROW EXCLUSIVE MODE");
        }
      }
      for (const [index, statement] of migration.sql.entries()) {
        if (statement.trim()) await client.query(scopeMigrationConstraintGuards(statement));
        if (preservePrintHistory && index === 0) await preserveLegacyPrintHistory(client);
      }
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [migration.hash, migration.folderMillis]);
      applied.add(migration.hash);
    }
    for (const repair of AUDIT_REPAIRS) {
      const hash = createHash("sha256").update(repair).digest("hex");
      if (applied.has(hash)) continue;
      const retiredRepair = /^-- audit A(?:98 v1|96 v1|97 v[12]):/.test(repair);
      if (!manualOnly || !retiredRepair) await client.query(repair);
      await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [hash, Math.max(...migrations.map(m => m.folderMillis))]);
      applied.add(hash);
    }
    // A privilege postcondition, not a new schema migration: every owner run
    // must preserve append-only audit access for this profile's runtime role,
    // including a fresh table created after default privileges were applied.
    await client.query(readFileSync(new URL("./audit-runtime-privileges.sql", import.meta.url), "utf8"));
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const hasDatabaseSettings = Boolean(
    runtimeSecret("DATABASE_URL") ||
    process.env.PGHOST ||
    process.env.PGDATABASE ||
    process.env.PGUSER ||
    runtimeSecret("PGPASSWORD"),
  );
  if (!hasDatabaseSettings) {
    throw new Error("PostgreSQL connection settings are required");
  }
  const { pool } = await import("../src/db");
  const client = await pool.connect();
  try { await migrateByHash(client, "./drizzle"); }
  finally { client.release(); }
  console.log("PostgreSQL migrations applied successfully");
  await pool.end();
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(async (e) => {
  console.error(e);
  const { pool } = await import("../src/db");
  await pool.end().catch(() => {});
  process.exit(1);
});
