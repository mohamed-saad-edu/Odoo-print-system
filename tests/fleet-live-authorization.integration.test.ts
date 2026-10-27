import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listAgents } from "../src/app/api/agents/route";
import { GET as listPrinters } from "../src/app/api/printers/route";
import { GET as listJobs } from "../src/app/api/jobs/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

describe.skipIf(!hasTestDatabase)("fleet and job history listings recheck current workspace and Agent authority", () => {
  let fixture: Fixture, managerToken: string, familyId: string;
  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", "live-fleet-authorization-contract-test-secret");
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
    await insertQueuedJob(fixture, "fleet-read-job");
    const session = await createWorkspaceManagerTestSession(fixture.tenantId, { role: "owner" });
    managerToken = session.token;
    familyId = session.familyId;
  });
  afterAll(async () => { await closePool(); vi.unstubAllEnvs(); });

  const routes = [
    ["agents", listAgents, "/api/agents"],
    ["printers", listPrinters, "/api/printers"],
    ["jobs", listJobs, "/api/jobs"],
  ] as const;

  async function race(
    handler: typeof listAgents,
    route: string,
    principal: "manager" | "agent",
    change: "suspend" | "revoke" | "disable_agent",
  ): Promise<Response> {
    const writer = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE tenants SET lifecycle=$2 WHERE id=$1",
        [fixture.tenantId, change === "suspend" ? "suspended" : "active"]);
      const pid = Number((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const authorization = principal === "agent" ? fixture.agentAuth : "Bearer " + managerToken;
      pending = handler(new Request("https://gateway.test" + route, { headers: { Authorization: authorization } }));
      void pending.catch(() => undefined);
      await expect.poll(async () => {
        const r = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
            WHERE datname=current_database() AND wait_event_type='Lock'
              AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
              AND $1=ANY(pg_blocking_pids(pid))`, [pid],
        );
        return Number(r.rows[0]?.n ?? 0);
      }, { timeout: 8000, interval: 100 }).toBeGreaterThan(0);
      if (change === "revoke") {
        await pool().query("UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE family_id=$1", [familyId]);
      } else if (change === "disable_agent") {
        await pool().query("UPDATE agents SET lifecycle='disabled' WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.agentId]);
      }
      await writer.query("COMMIT");
      committed = true;
      return await pending;
    } finally {
      if (!committed) await writer.query("ROLLBACK");
      writer.release();
      await pending?.catch(() => undefined);
    }
  }

  it.each(routes)("%s current workspace owner can list its scoped fleet", async (_name, handler, route) => {
    const response = await handler(new Request("https://gateway.test" + route, {
      headers: { Authorization: "Bearer " + managerToken },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it.each(routes)("%s cannot disclose inventory after concurrent workspace suspension", async (_name, handler, route) => {
    const response = await race(handler, route, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it.each(routes)("%s cannot disclose inventory after concurrent manager logout", async (_name, handler, route) => {
    const response = await race(handler, route, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it.each(routes)("%s cannot disclose Agent-owned inventory after the Agent is disabled", async (_name, handler, route) => {
    const response = await race(handler, route, "agent", "disable_agent");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
