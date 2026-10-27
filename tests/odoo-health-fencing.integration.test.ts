import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as healthGET } from "../src/app/api/odoo/health/route";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("Odoo health authentication and lifecycle fences", () => {
  let fixture: Fixture;
  const request = () => new Request("https://gateway.test/api/odoo/health", {
    headers: { "x-api-key": fixture.odooKey },
  });

  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
  });
  afterAll(async () => { await closePool(); });

  it.each([
    ["revoked credential", "UPDATE api_keys SET revoked_at=clock_timestamp(),read_only_until=NULL WHERE tenant_id=$1", 401],
    ["disabled integration", "UPDATE api_keys SET odoo_enabled=FALSE WHERE tenant_id=$1", 200],
  ] as const)("returns current status after %s changes between initial authentication and the health read", async (_reason, mutation, expected) => {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle='active' WHERE id=$1", [fixture.tenantId]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = healthGET(request());
      void pending.catch(() => undefined);
      // A correct read must wait at the tenant FOR SHARE fence. An unfenced
      // health GET can use a stale key/activation snapshot and return false OK.
      await expect.poll(async () => {
        const row = await pool().query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%' AND $1 = ANY(pg_blocking_pids(pid))",
          [blockerPid],
        );
        return Number(row.rows[0]?.n ?? 0);
      }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
      await pool().query(mutation, [fixture.tenantId]);
      await blocker.query("COMMIT");
      committed = true;
      const response = await pending;
      expect(response.status).toBe(expected);
      if (expected === 401) expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
      else expect(await response.json()).toMatchObject({ ok: true, enabled: false });
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });

  it("denies a tenant suspended while its health request is waiting at the lifecycle fence", async () => {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle='suspended' WHERE id=$1", [fixture.tenantId]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = healthGET(request());
      void pending.catch(() => undefined);
      await expect.poll(async () => {
        const row = await pool().query(
          "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%' AND $1 = ANY(pg_blocking_pids(pid))",
          [blockerPid],
        );
        return Number(row.rows[0]?.n ?? 0);
      }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
      await blocker.query("COMMIT");
      committed = true;
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });

  it("keeps the documented read-only credential rotation grace for setup health", async () => {
    await pool().query(
      "UPDATE api_keys SET revoked_at=clock_timestamp()-interval '1 second', read_only_until=clock_timestamp()+interval '30 minutes' WHERE tenant_id=$1",
      [fixture.tenantId],
    );
    const response = await healthGET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, enabled: true });
  });
});
