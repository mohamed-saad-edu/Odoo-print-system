import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { migrateByHash } from "../scripts/db-migrate";

const hasTestDatabase = Boolean(process.env.DATABASE_URL);
describe.skipIf(!hasTestDatabase)("manual billing historical field preservation", () => {
  let admin: Pool, target: Pool, directory: string, database: string;
  let expectedPlans: unknown[], expectedSubscriptions: unknown[];
  async function migrate(folder: string) {
    const client = await target.connect();
    try { await migrateByHash(client, folder); } finally { client.release(); }
  }
  beforeAll(async () => {
    const source = new URL(process.env.DATABASE_URL!); source.pathname = "/postgres";
    admin = new Pool({ connectionString: source.href, max: 1 });
    database = `billing_history_${randomBytes(8).toString("hex")}`;
    await admin.query(`CREATE DATABASE "${database}"`);
    source.pathname = `/${database}`;
    target = new Pool({ connectionString: source.href, max: 2, options: "-c timezone=UTC" });
    directory = await mkdtemp(join(tmpdir(), "yaseir-billing-history-"));
    await mkdir(join(directory, "meta"));
    const journal = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 98);
    await writeFile(join(directory, "meta/_journal.json"), JSON.stringify({ ...journal, entries }));
    for (const entry of entries) await cp(join("drizzle", `${entry.tag}.sql`), join(directory, `${entry.tag}.sql`));
    await migrate(directory);
    // The first records contain ONLY fields omitted by immutable0098's archive;
    // the second records exercise populated provider IDs and every retired field.
    await target.query(`INSERT INTO tenants(id,name) VALUES ('omitted-only','Omitted only'),('complete','Complete')`);
    await target.query(`INSERT INTO plans(id,name,currency,interval,stripe_price_id,stripe_price_history,stripe_product_id)
      VALUES ('omitted-plan','Omitted plan','EGP','year',NULL,ARRAY[]::text[],NULL),
        ('complete-plan','Complete plan','USD','month','price_full',ARRAY['price_old'],'product_full')`);
    await target.query(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,trial_started_at,checkout_plan_id,checkout_intent_created_at,checkout_session_expires_at,billing_operation_type,billing_operation_idempotency_key)
      VALUES ('omitted-only','omitted-plan','active','2026-01-01','omitted-plan','2026-01-02','2026-01-03','cancel','omitted-operation')`);
    await target.query(`INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,stripe_customer_id,stripe_subscription_id,stripe_last_event_created_at,stripe_state_revision,trial_started_at,checkout_status,checkout_plan_id,checkout_idempotency_key,checkout_request_params,checkout_intent_created_at,checkout_session_id,checkout_session_url,checkout_session_expires_at,billing_operation_id,billing_operation_type,billing_operation_idempotency_key,billing_operation_subscription_id)
      VALUES ('complete','complete-plan','active','customer_full','subscription_full','2026-02-01',7,'2026-01-01','open','complete-plan','checkout-key','{"plan":"full"}','2026-02-02','session_full','https://billing.example.test/full','2026-02-03','operation_full','resume','operation-key','subscription_full')`);
    expectedPlans = (await target.query(`SELECT id AS plan_id,to_jsonb(p)-ARRAY['id','name','description','entitlements','is_active','is_public','display_order','created_at','updated_at'] AS provider_metadata FROM plans p ORDER BY id`)).rows;
    expectedSubscriptions = (await target.query(`SELECT tenant_id,to_jsonb(s)-ARRAY['tenant_id','plan_id','status','subscription_type','monthly_quota','term','internal_reference','revision','current_period_start','current_period_end','cancel_at_period_end','entitlement_blocked','entitlement_blocked_reason','created_at','updated_at'] AS provider_metadata FROM tenant_subscriptions s ORDER BY tenant_id`)).rows;
  });
  afterAll(async () => {
    await target?.end();
    // Retain the isolated fixture database until the disposable container ends.
    try { await admin?.end(); }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
  });
  it("archives every retired field and omitted-only row before dropping columns, preserving the published checksum", async () => {
    const published = await readFile("drizzle/0098_manual_only_billing.sql", "utf8");
    const before = (await target.query("SELECT to_jsonb(s) AS row FROM tenant_subscriptions s ORDER BY tenant_id")).rows;
    const beforeLedger = (await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    await target.query("CREATE VIEW public.billing_history_dependency AS SELECT currency FROM plans");
    await expect(migrate(join(process.cwd(), "drizzle"))).rejects.toThrow(/depend/i);
    expect((await target.query("SELECT to_jsonb(s) AS row FROM tenant_subscriptions s ORDER BY tenant_id")).rows).toEqual(before);
    expect((await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(beforeLedger);
    expect((await target.query("SELECT to_regnamespace('legacy_billing') AS archive")).rows[0].archive).toBeNull();
    await target.query("DROP VIEW public.billing_history_dependency");
    await migrate(join(process.cwd(), "drizzle"));
    const archivedPlans = (await target.query("SELECT plan_id,provider_metadata FROM legacy_billing.plan_provider_history ORDER BY plan_id")).rows;
    const archivedSubscriptions = (await target.query("SELECT tenant_id,provider_metadata FROM legacy_billing.subscription_provider_history ORDER BY tenant_id")).rows;
    expect(archivedPlans).toEqual(expectedPlans);
    expect(archivedSubscriptions).toEqual(expectedSubscriptions);
    expect(await readFile("drizzle/0098_manual_only_billing.sql", "utf8")).toBe(published);
    const ledger = (await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
    await migrate(join(process.cwd(), "drizzle"));
    expect((await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(ledger);
    expect((await target.query("SELECT plan_id,provider_metadata FROM legacy_billing.plan_provider_history ORDER BY plan_id")).rows).toEqual(archivedPlans);
    expect((await target.query("SELECT tenant_id,provider_metadata FROM legacy_billing.subscription_provider_history ORDER BY tenant_id")).rows).toEqual(archivedSubscriptions);
  });
});
