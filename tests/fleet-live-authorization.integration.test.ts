import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listAgents } from "../src/app/api/agents/route";
import { GET as listPrinters } from "../src/app/api/printers/route";
import { GET as listJobs } from "../src/app/api/jobs/route";
import { GET as getAgentDetail } from "../src/app/api/agents/[id]/route";
import { GET as getPrinterDetail } from "../src/app/api/printers/[id]/route";
import { GET as getCapabilities } from "../src/app/api/printers/capabilities/route";
import { POST as testPrinterConnection } from "../src/app/api/printers/[id]/test-connection/route";
import { GET as getJobTimelineDetail } from "../src/app/api/jobs/[id]/timeline/route";
import { GET as listAgentDiscovery } from "../src/app/api/agents/[id]/discovery/route";
import { GET as getAgentDiscoveryDetail } from "../src/app/api/agents/[id]/discovery/[discoveryId]/route";
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
    handler: (req: Request) => Promise<Response>,
    route: string,
    principal: "manager" | "agent",
    change: "suspend" | "revoke" | "disable_agent" | "rotate_agent",
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
      } else if (change === "rotate_agent") {
        await pool().query("UPDATE agents SET secret=$3 WHERE tenant_id=$1 AND id=$2",
          [fixture.tenantId, fixture.agentId, "f".repeat(64)]);
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

  it.each(routes)("%s active Agent reads only its own scoped records", async (name, handler, route) => {
    const response = await handler(new Request("https://gateway.test" + route, {
      headers: { Authorization: fixture.agentAuth },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const expected = name === "agents" ? fixture.agentId :
      name === "printers" ? fixture.printerId : "fleet-read-job";
    expect(body).toEqual(expect.arrayContaining([expect.objectContaining({ id: expected })]));
  });

  it.each(routes)("%s cannot disclose the fleet after concurrent Agent credential rotation", async (_name, handler, route) => {
    const response = await race(handler, route, "agent", "rotate_agent");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
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

  const agentDetail = (req: Request) =>
    getAgentDetail(req, { params: Promise.resolve({ id: fixture.agentId }) });
  const printerDetail = (req: Request) =>
    getPrinterDetail(req, { params: Promise.resolve({ id: fixture.printerId }) });

  it("agent detail cannot disclose after concurrent manager logout", async () => {
    const response = await race(agentDetail, `/api/agents/${fixture.agentId}`, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("agent detail cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(agentDetail, `/api/agents/${fixture.agentId}`, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("printer detail cannot disclose after concurrent manager logout", async () => {
    const response = await race(printerDetail, `/api/printers/${fixture.printerId}`, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("printer detail cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(printerDetail, `/api/printers/${fixture.printerId}`, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("printer detail cannot disclose after concurrent Agent credential rotation", async () => {
    const response = await race(printerDetail, `/api/printers/${fixture.printerId}`, "agent", "rotate_agent");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  const capabilities = (req: Request) =>
    getCapabilities(req);
  it("printer capability matrix cannot disclose after concurrent manager logout", async () => {
    const response = await race(capabilities, `/api/printers/capabilities?printerId=${fixture.printerId}`, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("printer capability matrix cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(capabilities, `/api/printers/capabilities?printerId=${fixture.printerId}`, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("printer capability page cannot disclose after concurrent manager logout", async () => {
    const response = await race(capabilities, "/api/printers/capabilities?limit=10", "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("printer capability page cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(capabilities, "/api/printers/capabilities?limit=10", "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  const printerConnectionDiagnostic = (req: Request) =>
    testPrinterConnection(new Request(req.url, { method: "POST", headers: req.headers }), {
      params: Promise.resolve({ id: fixture.printerId }),
    });

  it("current owner can inspect cached printer connectivity without claiming a live probe", async () => {
    const response = await printerConnectionDiagnostic(new Request(
      `https://gateway.test/api/printers/${fixture.printerId}/test-connection`, {
        headers: { Authorization: "Bearer " + managerToken },
      },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ live: false });
  });

  it("connection diagnostic cannot disclose after concurrent manager logout", async () => {
    const response = await race(printerConnectionDiagnostic,
      `/api/printers/${fixture.printerId}/test-connection`, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("connection diagnostic cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(printerConnectionDiagnostic,
      `/api/printers/${fixture.printerId}/test-connection`, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("connection diagnostic cannot disclose after concurrent Agent credential rotation", async () => {
    const response = await race(printerConnectionDiagnostic,
      `/api/printers/${fixture.printerId}/test-connection`, "agent", "rotate_agent");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });

  const jobTimelineDetail = (req: Request) =>
    getJobTimelineDetail(req, { params: Promise.resolve({ id: "fleet-read-job" }) });

  it("current owner can inspect exact workspace job timeline without claim-token disclosure", async () => {
    const response = await jobTimelineDetail(new Request(
      "https://gateway.test/api/jobs/fleet-read-job/timeline", {
        headers: { Authorization: "Bearer " + managerToken },
      },
    ));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ jobId: "fleet-read-job", tenantId: fixture.tenantId });
  });

  it("job timeline cannot disclose after concurrent manager logout", async () => {
    const response = await race(jobTimelineDetail, "/api/jobs/fleet-read-job/timeline", "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it("job timeline cannot disclose after concurrent tenant suspension", async () => {
    const response = await race(jobTimelineDetail, "/api/jobs/fleet-read-job/timeline", "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  const discoveryRequest = (kind: "list" | "detail") => {
    const discoveryId = "fleet-authority-snapshot";
    const route = kind === "list"
      ? `/api/agents/${fixture.agentId}/discovery`
      : `/api/agents/${fixture.agentId}/discovery/${discoveryId}`;
    const handler = (req: Request) => kind === "list"
      ? listAgentDiscovery(req, { params: Promise.resolve({ id: fixture.agentId }) })
      : getAgentDiscoveryDetail(req, {
          params: Promise.resolve({ id: fixture.agentId, discoveryId }),
        });
    return { route, handler };
  };
  async function seedDiscovery(): Promise<void> {
    await pool().query(
      "INSERT INTO discovery_sessions (id,tenant_id,agent_id,status) VALUES ($1,$2,$3,'completed')",
      ["fleet-authority-snapshot", fixture.tenantId, fixture.agentId],
    );
  }

  it.each(["list", "detail"] as const)("%s discovery read returns scoped inventory to a live owner", async kind => {
    await seedDiscovery();
    const { route, handler } = discoveryRequest(kind);
    const response = await handler(new Request("https://gateway.test" + route, {
      headers: { Authorization: "Bearer " + managerToken },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    const body = await response.json();
    expect(kind === "list" ? body[0]?.id : body.session?.id).toBe("fleet-authority-snapshot");
  });

  it.each(["list", "detail"] as const)("%s discovery read cannot expose after concurrent manager logout", async kind => {
    await seedDiscovery();
    const { route, handler } = discoveryRequest(kind);
    const response = await race(handler, route, "manager", "revoke");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });

  it.each(["list", "detail"] as const)("%s discovery read cannot expose after concurrent workspace suspension", async kind => {
    await seedDiscovery();
    const { route, handler } = discoveryRequest(kind);
    const response = await race(handler, route, "manager", "suspend");
    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it.each(routes)("%s cannot disclose Agent-owned inventory after the Agent is disabled", async (_name, handler, route) => {
    const response = await race(handler, route, "agent", "disable_agent");
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
  });
});
