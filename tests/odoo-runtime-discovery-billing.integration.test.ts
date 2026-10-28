import geometryFixtures from "../contracts/printer-geometry-fixtures.json";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as agentsGET } from "../src/app/api/odoo/agents/route";
import { GET as printersGET } from "../src/app/api/odoo/printers/route";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("Odoo runtime discovery billing boundary", () => {
  let fixture: Fixture;

  beforeAll(async () => {
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
  });

  afterAll(async () => {
    await closePool();
  });

  it("blocks discovery after the manual subscription expires", async () => {
    await pool().query(
      "UPDATE tenant_subscriptions SET status = 'expired', current_period_end = now() - interval '1 minute' WHERE tenant_id = $1",
      [fixture.tenantId],
    );

    const response = await agentsGET(
      new Request("https://gateway.test/api/odoo/agents", {
        headers: { "x-api-key": fixture.odooKey },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
  });

  it("blocks printer inventory discovery after manual suspension", async () => {
    await pool().query(
      "UPDATE tenant_subscriptions SET status = 'suspended', current_period_end = now() - interval '1 minute' WHERE tenant_id = $1",
      [fixture.tenantId],
    );

    const response = await printersGET(
      new Request("https://gateway.test/api/odoo/printers", {
        headers: { "x-api-key": fixture.odooKey },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: "SUBSCRIPTION_REQUIRED",
    });
  });

  it.each([
    ["agents", agentsGET, "/api/odoo/agents"],
    ["printers", printersGET, "/api/odoo/printers"],
  ] as const)("denies %s inventory if workspace is suspended between key auth and read", async (_name, handler, route) => {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle='suspended' WHERE id=$1", [fixture.tenantId]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      // The first authorization SELECT sees the previously committed active
      // record. The inventory transaction must wait for the tenant row fence.
      pending = handler(new Request("https://gateway.test" + route, { headers: { "x-api-key": fixture.odooKey } }));
      await expect.poll(async () => {
        const waiting = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
             AND $1 = ANY(pg_blocking_pids(pid))`, [blockerPid],
        );
        return Number(waiting.rows[0].n);
      }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
      await blocker.query("COMMIT");
      committed = true;
      const response = await pending;
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => {});
    }
  });

  it.each([
    ["agents", agentsGET, "/api/odoo/agents"],
    ["printers", printersGET, "/api/odoo/printers"],
  ] as const)("rechecks revoked credentials after workspace lock before exposing %s inventory", async (_name, handler, route) => {
    const blocker = await pool().connect();
    let settled = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      // An innocuous admin update holds the tenant-row fence long enough for
      // Odoo key authentication to complete on its earlier snapshot.
      await blocker.query("UPDATE tenants SET lifecycle='active' WHERE id=$1", [fixture.tenantId]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = handler(new Request("https://gateway.test" + route, {headers: {"x-api-key":fixture.odooKey}}));
      await expect.poll(async () => {
        const waiting = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
             AND $1 = ANY(pg_blocking_pids(pid))`, [blockerPid],
        );
        return Number(waiting.rows[0].n);
      }, {timeout: 8_000, interval: 100}).toBeGreaterThan(0);
      // Revocation commits independently while the request is blocked at the
      // tenant fence. An initial valid key check is no longer authority.
      const revoked = await pool().query(
        "UPDATE api_keys SET revoked_at=clock_timestamp(), read_only_until=NULL WHERE tenant_id=$1",
        [fixture.tenantId],
      );
      expect(revoked.rowCount).toBeGreaterThan(0);
      await blocker.query("COMMIT");
      settled = true;
      const response = await pending;
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({code: "UNAUTHORIZED"});
    } finally {
      if (!settled) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => {});
    }
  });

  it.each([
    ["agents", agentsGET, "/api/odoo/agents"],
    ["printers", printersGET, "/api/odoo/printers"],
  ] as const)("refuses %s inventory when Odoo integration is disabled", async (_name, handler, route) => {
    await pool().query("UPDATE api_keys SET odoo_enabled=FALSE WHERE tenant_id=$1", [fixture.tenantId]);
    const response = await handler(new Request("https://gateway.test" + route, {headers: {"x-api-key":fixture.odooKey}}));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({code: "UNAUTHORIZED"});
  });

  it.each([
    ["agents", agentsGET, "/api/odoo/agents"],
    ["printers", printersGET, "/api/odoo/printers"],
  ] as const)("rechecks activation after HTTP key authentication for %s inventory", async (_name, handler, route) => {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle='active' WHERE id=$1", [fixture.tenantId]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = handler(new Request("https://gateway.test" + route, {headers: {"x-api-key":fixture.odooKey}}));
      await expect.poll(async () => {
        const waiting = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
             AND $1 = ANY(pg_blocking_pids(pid))`, [blockerPid],
        );
        return Number(waiting.rows[0].n);
      }, {timeout: 8_000, interval: 100}).toBeGreaterThan(0);
      // The credential is disabled after the first HTTP auth snapshot.
      await pool().query("UPDATE api_keys SET odoo_enabled=FALSE, odoo_enabled_revision=odoo_enabled_revision+1 WHERE tenant_id=$1", [fixture.tenantId]);
      await blocker.query("COMMIT");
      committed = true;
      const response = await pending;
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({code: "UNAUTHORIZED"});
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => {});
    }
  });

  it.each([
    ["agents", agentsGET, "/api/odoo/agents"],
    ["printers", printersGET, "/api/odoo/printers"],
  ] as const)("retains the documented read-only rotation grace for %s inventory", async (_name, handler, route) => {
    await pool().query(
      "UPDATE api_keys SET revoked_at=clock_timestamp()-interval '1 second', read_only_until=clock_timestamp()+interval '30 minutes' WHERE tenant_id=$1",
      [fixture.tenantId],
    );
    const response = await handler(new Request("https://gateway.test" + route, {headers: {"x-api-key":fixture.odooKey}}));
    expect(response.status).toBe(200);
  });

  it("publishes bounded selected roll media separately from printable dots", async () => {
    await pool().query(
      "UPDATE printers SET capabilities = $1::jsonb, config = COALESCE(config,'{}'::jsonb) || $2::jsonb WHERE tenant_id = $3 AND id = $4",
      [
        JSON.stringify({ geometry: { ...geometryFixtures.geometryCases.find((entry) => entry.name === "physical-384-dots-203-dpi-58-mm")!.geometry, printer_id: fixture.printerId }, supported_protocols: ["pdf", "image"] }),
        // This is a configured profile, not an independently observed driver
        // measurement. Publish it only when the selected desired profile
        // matches the claimed dimensions (the production trust boundary).
        JSON.stringify({ geometry_profile: { printable_width_dots: 384, dpi_x: 203, dpi_y: 203, paper_width_mm: 58, raster_command: "gs_v_0" } }),
        fixture.tenantId, fixture.printerId,
      ],
    );
    const request = () => new Request("https://gateway.test/api/odoo/printers", { headers: { "x-api-key": fixture.odooKey } });
    const response = await printersGET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.printers.find((printer: { id: string }) => printer.id === fixture.printerId)).toMatchObject({
      capabilities: { paper_width_mm: 58 }, printableWidthDots: 384,
    });
    await pool().query(
      "UPDATE printers SET capabilities = $1::jsonb, config = '{}'::jsonb WHERE tenant_id = $2 AND id = $3",
      [JSON.stringify({ max_paper_width: 512, paper_widths: [58, 80] }), fixture.tenantId, fixture.printerId],
    );
    const ambiguous = await (await printersGET(request())).json();
    const ambiguousPrinter = ambiguous.printers.find((printer: { id: string }) => printer.id === fixture.printerId);
    expect(ambiguousPrinter.capabilities).not.toHaveProperty("paper_width_mm");
    expect(ambiguousPrinter.printableWidthDots).toBeNull();
  });
});
