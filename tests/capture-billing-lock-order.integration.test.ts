import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool as gatewayPool } from "../src/db";
import { queueOdooCapture, parseCaptureRequest } from "../src/lib/e2e-capture";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
suite("capture and runtime admission lock order", () => {
  beforeAll(async () => { await applyMigrations(); vi.stubEnv("YASEIR_E2E_CAPTURE_ENABLED", "1"); });
  afterAll(async () => { vi.unstubAllEnvs(); await closePool(); await gatewayPool.end(); });

  it("rejects expired billing without inserting capture work", async () => {
    const fixture = await seedFixture();
    const key = await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId]);
    await pool().query("UPDATE tenant_subscriptions SET current_period_end=now()-interval '1 minute' WHERE tenant_id=$1", [fixture.tenantId]);
    await expect(queueOdooCapture({ id: key.rows[0].id, tenantId: fixture.tenantId }, parseCaptureRequest({
      agentId: fixture.agentId, idempotencyKey: "capture-ineligible-intent", paperMm: 0,
      payload: { type: "pdf", encoding: "base64", data: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") },
    }))).rejects.toMatchObject({ code: "TENANT_SUBSCRIPTION_REQUIRED" });
    const rows = await pool().query("SELECT id FROM e2e_capture_runs WHERE tenant_id=$1", [fixture.tenantId]);
    expect(rows.rowCount).toBe(0);
  });

  it("does not hold billing while waiting for an Agent owned by another runtime transaction", async () => {
    const fixture = await seedFixture();
    const key = await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId]);
    const blocker = await pool().connect();
    let capture: Promise<unknown> | undefined;
    let captureError: unknown;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SET LOCAL lock_timeout='350ms'");
      await blocker.query("SELECT id FROM agents WHERE id=$1 FOR UPDATE", [fixture.agentId]);
      capture = queueOdooCapture({ id: key.rows[0].id, tenantId: fixture.tenantId }, parseCaptureRequest({
        agentId: fixture.agentId, idempotencyKey: "capture-lock-order-intent", paperMm: 0,
        payload: { type: "pdf", encoding: "base64", data: Buffer.from("%PDF-1.4\n%%EOF\n").toString("base64") },
      }));
      // Attach rejection handling immediately while deliberately holding the peer lock.
      void capture.catch(error => { captureError = error; });
      await vi.waitFor(async () => {
        const activity = await pool().query(`SELECT 1 FROM pg_stat_activity
          WHERE datname=current_database() AND pid<>pg_backend_pid()
            AND wait_event_type='Lock' AND query LIKE '%SELECT id FROM agents WHERE id = $1%'
            AND query NOT LIKE '%pg_stat_activity%'`);
        expect(activity.rowCount).toBeGreaterThan(0);
      });
      // Runtime admission already owns the Agent and now needs its subscription.
      // The capture must wait without holding that later resource.
      await expect(blocker.query("SELECT tenant_id FROM tenant_subscriptions WHERE tenant_id=$1 FOR UPDATE", [fixture.tenantId])).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await capture;
    }
    expect(captureError).toBeUndefined();
    const rows = await pool().query("SELECT status FROM e2e_capture_runs WHERE tenant_id=$1", [fixture.tenantId]);
    expect(rows.rows).toEqual([{ status: "queued" }]);
  });
});
