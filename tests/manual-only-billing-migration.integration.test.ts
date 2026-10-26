import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { applyMigrations, hasTestDatabase, pool, closePool, billingArchiveSchema } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
suite("manual-only billing migration", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  it("removes all obsolete provider columns without removing operational subscription fields", async () => {
    const fields = await pool().query(`SELECT table_name,column_name
      FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name IN ('plans','tenant_subscriptions')
      AND (column_name LIKE 'stripe_%' OR column_name LIKE 'checkout_%'
        OR column_name LIKE 'billing_operation_%'
        OR column_name IN ('billing_mode','currency','interval','trial_started_at'))`);
    expect(fields.rows).toEqual([]);
    const active = await pool().query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=current_schema() AND table_name='tenant_subscriptions'
      AND column_name IN ('monthly_quota','subscription_type','term','internal_reference','revision')`);
    expect(active.rowCount).toBe(5);
  });
  it("retains historical event tables in a non-public archive", async () => {
    const result = await pool().query(`SELECT table_schema,table_name
      FROM information_schema.tables
      WHERE table_schema = $1 AND table_name IN ('billing_events','print_usage_periods')
      ORDER BY table_name`, [billingArchiveSchema()]);
    expect(result.rows).toEqual([
      { table_schema: billingArchiveSchema(), table_name: "billing_events" },
      { table_schema: billingArchiveSchema(), table_name: "print_usage_periods" },
    ]);
  });
});
