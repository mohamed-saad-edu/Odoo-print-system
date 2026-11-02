import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, insertQueuedJob, type Fixture,
} from "./helpers/pg";
import { createWorkspaceManagerTestSession, issueWorkspaceTestSession } from "./helpers/workspace-session";
import { rotateRefreshToken } from "../src/lib/session-tokens";
import { discoveryObservationFingerprint } from "../src/lib/discovery-observation";
import { POST as discoveryStart } from "../src/app/api/agents/[id]/discovery/route";
import { POST as discoveryCancel } from "../src/app/api/agents/[id]/discovery/[discoveryId]/cancel/route";
import { POST as deviceVerify } from "../src/app/api/agents/[id]/discovered-printers/[deviceId]/verify/route";
import { POST as deviceProvision } from "../src/app/api/agents/[id]/discovered-printers/[deviceId]/provision/route";
import { POST as printerCertify } from "../src/app/api/printers/[id]/certify/route";
import { POST as printerTestPrint } from "../src/app/api/printers/[id]/test-print/route";
import { POST as jobCancel } from "../src/app/api/jobs/[id]/cancel/route";
import { POST as jobReprint } from "../src/app/api/jobs/[id]/reprint/route";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const suite = describe.skipIf(!hasTestDatabase);

suite("WP-A frictionless security: anomaly audit + audit-trail completeness", () => {
  let f: Fixture;
  let managerToken: string;

  beforeAll(async () => {
    process.env.GATEWAY_JWT_SECRET = "wpa-tests-secret-at-least-32-chars";
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.COOKIE_SECURE = "1";
    await applyMigrations();
  });
  afterAll(async () => { await closePool(); });

  beforeEach(async () => {
    await truncateAll();
    f = await seedFixture();
    const manager = await createWorkspaceManagerTestSession(f.tenantId, { role: "owner" });
    managerToken = manager.token;
    await pool().query("INSERT INTO tenants (id, name) VALUES ($1, $2)", ["wpa_tenant", "WPA Tenant"]);
    await pool().query(
      "INSERT INTO users (id, email, password_hash, email_verified_at) VALUES ($1, $2, $3, clock_timestamp())",
      ["wpa_user", "wpa@example.test", "unused"],
    );
    await pool().query(
      "INSERT INTO tenant_users (user_id, tenant_id, role) VALUES ($1, $2, $3)",
      ["wpa_user", "wpa_tenant", "admin"],
    );
  });

  const mgrReq = (url: string, init?: RequestInit) => new Request(url, {
    ...init,
    headers: {
      cookie: `mgr_session=${managerToken}`,
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const auditCount = async (action: string, tenantId: string, resourceId?: string) => {
    const rows = (await pool().query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE action = $1 AND tenant_id = $2 AND ($3::text IS NULL OR resource_id = $3)",
      [action, tenantId, resourceId ?? null],
    )).rows;
    return rows[0].n as number;
  };
  const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) }) as never;

  it("S1: refresh from a different IP writes exactly one audit row and still succeeds", async () => {
    const pair = await issueWorkspaceTestSession(
      { kind: "manager", tenantId: "wpa_tenant", userId: "wpa_user", role: "admin", email: "wpa@example.test" },
      { ipAddress: "203.0.113.10", userAgent: CHROME_WINDOWS },
    );
    const outcome = await rotateRefreshToken("manager", pair.refreshToken, {
      ipAddress: "198.51.100.7", userAgent: SAFARI_IPHONE,
    });
    expect(outcome.status).toBe("rotated");
    expect(await auditCount("auth.session.ip_changed", "wpa_tenant")).toBe(1);
    expect(await auditCount("auth.session.device_changed", "wpa_tenant")).toBe(0);
  });

  it("S1: refresh with unchanged context writes no anomaly row", async () => {
    const pair = await issueWorkspaceTestSession(
      { kind: "manager", tenantId: "wpa_tenant", userId: "wpa_user", role: "admin", email: "wpa@example.test" },
      { ipAddress: "203.0.113.10", userAgent: CHROME_WINDOWS },
    );
    const outcome = await rotateRefreshToken("manager", pair.refreshToken, {
      ipAddress: "203.0.113.10", userAgent: CHROME_WINDOWS,
    });
    expect(outcome.status).toBe("rotated");
    expect(await auditCount("auth.session.ip_changed", "wpa_tenant")).toBe(0);
    expect(await auditCount("auth.session.device_changed", "wpa_tenant")).toBe(0);
  });

  it("S1: first token in a family (issued without context) writes no anomaly row", async () => {
    const pair = await issueWorkspaceTestSession(
      { kind: "manager", tenantId: "wpa_tenant", userId: "wpa_user", role: "admin", email: "wpa@example.test" },
    );
    const outcome = await rotateRefreshToken("manager", pair.refreshToken, {
      ipAddress: "198.51.100.7", userAgent: SAFARI_IPHONE,
    });
    expect(outcome.status).toBe("rotated");
    expect(await auditCount("auth.session.ip_changed", "wpa_tenant")).toBe(0);
    expect(await auditCount("auth.session.device_changed", "wpa_tenant")).toBe(0);
  });

  it("S3: discovery start writes an audit row", async () => {
    const response = await discoveryStart(
      mgrReq(`http://localhost:3000/api/agents/${f.agentId}/discovery`, { method: "POST", body: "{}" }),
      params({ id: f.agentId }),
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { discoveryId: string };
    expect(await auditCount("agent.discovery.started", f.tenantId, body.discoveryId)).toBe(1);
  });

  it("S3: discovery cancel writes an audit row", async () => {
    await pool().query(
      "INSERT INTO discovery_sessions (id, tenant_id, agent_id, status, config, stats) VALUES ($1, $2, $3, 'running', '{}'::jsonb, '{}'::jsonb)",
      ["dsc_wpa_cancel", f.tenantId, f.agentId],
    );
    const response = await discoveryCancel(
      mgrReq(`http://localhost:3000/api/agents/${f.agentId}/discovery/dsc_wpa_cancel/cancel`, { method: "POST", body: "{}" }),
      params({ id: f.agentId, discoveryId: "dsc_wpa_cancel" }),
    );
    expect(response.status).toBe(200);
    expect(await auditCount("agent.discovery.cancelled", f.tenantId, "dsc_wpa_cancel")).toBe(1);
  });

  it("S3: discovered-device verify writes an audit row", async () => {
    const device = {
      id: "dev_wpa_verify", tenantId: f.tenantId, agentId: f.agentId, discoveryId: "dsc_wpa_verify",
      protocol: "ipp", ipAddress: "192.168.1.10", port: 631, uri: "ipp://192.168.1.10:631/ipp/print",
      transport: "ipp", deviceClass: "unknown", capabilities: {},
    };
    await pool().query(
      "INSERT INTO discovery_sessions (id, tenant_id, agent_id, status, config, stats) VALUES ($1, $2, $3, 'completed', '{}'::jsonb, '{}'::jsonb)",
      [device.discoveryId, device.tenantId, device.agentId],
    );
    await pool().query(
      "INSERT INTO discovered_devices (id, tenant_id, agent_id, discovery_id, protocol, ip_address, port, uri, transport, device_class, capabilities, candidate_status, verification) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, '{}'::jsonb, 'discovered', 'candidate')",
      [device.id, device.tenantId, device.agentId, device.discoveryId, device.protocol, device.ipAddress, device.port, device.uri, device.transport, device.deviceClass],
    );
    const fingerprint = discoveryObservationFingerprint({ ...device, deviceName: null, hostname: null, spoolerName: null, manufacturer: null, model: null, serialNumber: null, macAddress: null, identityKey: null });
    const response = await deviceVerify(
      mgrReq(`http://localhost:3000/api/agents/${f.agentId}/discovered-printers/${device.id}/verify`,
        { method: "POST", headers: { "If-Match": `"${fingerprint}"` } }),
      params({ id: f.agentId, deviceId: device.id }),
    );
    expect(response.status).toBe(200);
    expect(await auditCount("printer.discovery.verified", f.tenantId, device.id)).toBe(1);
  });

  it("S3: discovered-device provision writes a printer.registered audit row", async () => {
    await pool().query(
      "INSERT INTO discovery_sessions (id, tenant_id, agent_id, status, config, stats) VALUES ($1, $2, $3, 'completed', '{}'::jsonb, '{}'::jsonb)",
      ["dsc_wpa_provision", f.tenantId, f.agentId],
    );
    await pool().query(
      "INSERT INTO discovered_devices (id, tenant_id, agent_id, discovery_id, protocol, ip_address, port, uri, transport, device_class, device_name, capabilities, candidate_status, verification) VALUES ($1, $2, $3, $4, 'ipp', '192.168.1.20', 631, 'ipp://192.168.1.20:631/ipp/print', 'ipp', 'unknown', 'WPA IPP Printer', '{}'::jsonb, 'verified', 'verified')",
      ["dev_wpa_provision", f.tenantId, f.agentId, "dsc_wpa_provision"],
    );
    const response = await deviceProvision(
      mgrReq(`http://localhost:3000/api/agents/${f.agentId}/discovered-printers/dev_wpa_provision/provision`, { method: "POST", body: "{}" }),
      params({ id: f.agentId, deviceId: "dev_wpa_provision" }),
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { printerId: string };
    expect(await auditCount("printer.registered", f.tenantId, body.printerId)).toBe(1);
  });

  it("S3: job cancel writes a job.canceled audit row", async () => {
    await insertQueuedJob(f, "job_wpa_cancel");
    const response = await jobCancel(
      mgrReq("http://localhost:3000/api/jobs/job_wpa_cancel/cancel", { method: "POST", body: "{}" }),
      params({ id: "job_wpa_cancel" }),
    );
    expect(response.status).toBe(200);
    expect(await auditCount("job.canceled", f.tenantId, "job_wpa_cancel")).toBe(1);
  });

  it("S3: job reprint writes a job.reprinted audit row", async () => {
    // Reprints are allowed only for unsuccessful terminal jobs.
    await insertQueuedJob(f, "job_wpa_orig");
    await pool().query("UPDATE print_jobs SET status = 'failed', error = 'WPA fixture failure' WHERE id = $1", ["job_wpa_orig"]);
    const response = await jobReprint(
      mgrReq("http://localhost:3000/api/jobs/job_wpa_orig/reprint",
        { method: "POST", headers: { "Idempotency-Key": "wpa-reprint-key-1" } }),
      params({ id: "job_wpa_orig" }),
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).not.toBe("job_wpa_orig");
    expect(await auditCount("job.reprinted", f.tenantId, "job_wpa_orig")).toBe(1);
  });

  it("S3: printer certify writes a certification-requested audit row", async () => {
    const response = await printerCertify(
      mgrReq(`http://localhost:3000/api/printers/${f.printerId}/certify`,
        { method: "POST", body: "{}", headers: { "Idempotency-Key": "wpa-certify-key-1" } }),
      params({ id: f.printerId }),
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { jobId: string | null };
    expect(body.jobId).toBeTruthy();
    expect(await auditCount("printer.certification.requested", f.tenantId, f.printerId)).toBe(1);
  });

  it("S3: printer test-print writes a test_print-requested audit row", async () => {
    const response = await printerTestPrint(
      mgrReq(`http://localhost:3000/api/printers/${f.printerId}/test-print`,
        { method: "POST", headers: { "Idempotency-Key": "wpa-testprint-key-1" } }),
      params({ id: f.printerId }),
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { jobId: string };
    expect(body.jobId).toBeTruthy();
    expect(await auditCount("printer.test_print.requested", f.tenantId, f.printerId)).toBe(1);
  });
});
