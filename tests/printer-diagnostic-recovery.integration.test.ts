import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { POST as testPrint } from "../src/app/api/printers/[id]/test-print/route";
import { POST as ordinaryPrint } from "../src/app/api/print/jobs/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { idempotencyDigest } from "../src/lib/print-job-service";
import { gatewayTestSigningKey } from "./helpers/test-secrets";
import { applyMigrations, closePool, hasTestDatabase, jobRow, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("diagnostic retry identity and live-Agent admission", () => {
  let f: Fixture;
  let manager: Awaited<ReturnType<typeof createWorkspaceManagerTestSession>>;
  let userId: string;

  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", gatewayTestSigningKey());
    await applyMigrations();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await truncateAll();
    f = await seedFixture();
    userId = `user_${f.tenantId}`;
    await pool().query("INSERT INTO users (id, email, password_hash, email_verified_at) VALUES ($1, $2, 'unused', clock_timestamp())", [userId, `${userId}@example.test`]);
    await pool().query("INSERT INTO tenant_users (user_id, tenant_id, role) VALUES ($1, $2, 'owner')", [userId, f.tenantId]);
    manager = await createWorkspaceManagerTestSession(f.tenantId, { userId, role: "owner" });
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await closePool();
  });

  const diagnostic = (key: string, actor: "manager" | "agent" = "manager", printerId = f.printerId) => testPrint(
    new Request(`https://gateway.test/api/printers/${printerId}/test-print`, {
      method: "POST", headers: { Authorization: actor === "agent" ? f.agentAuth : `Bearer ${manager.token}`, "Idempotency-Key": key },
    }), { params: Promise.resolve({ id: printerId }) },
  );
  const jobCount = async () => Number((await pool().query("SELECT COUNT(*) AS count FROM print_jobs WHERE tenant_id = $1", [f.tenantId])).rows[0].count);
  const accept = async (key: string, actor: "manager" | "agent" = "manager") => {
    const response = await diagnostic(key, actor);
    expect(response.status).toBe(201);
    return response.json() as Promise<{ jobId: string }>;
  };

  it.each(["manager", "agent"] as const)("returns the accepted operation to the same %s after its Agent disconnects", async (actor) => {
    const first = await accept("same-diagnostic-key", actor);
    await pool().query("UPDATE agents SET status = 'offline' WHERE id = $1", [f.agentId]);
    const response = await diagnostic("same-diagnostic-key", actor);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ jobId: first.jobId, isReused: true });
    expect(await jobCount()).toBe(1);
  });

  it.each([
    { label: "disabled printer", table: "printers", state: "disabled", freshStatus: 409 },
    { label: "retired printer", table: "printers", state: "retired", freshStatus: 409 },
    { label: "disabled Agent", table: "agents", state: "disabled", freshStatus: 503 },
    { label: "retired Agent", table: "agents", state: "retired", freshStatus: 503 },
  ] as const)("reconciles an accepted operation after $label without authorizing a new one", async ({ table, state, freshStatus }) => {
    const first = await accept("same-lifecycle-key");
    if (table === "printers") await pool().query("UPDATE printers SET lifecycle = $1 WHERE id = $2", [state, f.printerId]);
    else await pool().query("UPDATE agents SET lifecycle = $1 WHERE id = $2", [state, f.agentId]);
    const replay = await diagnostic("same-lifecycle-key");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ jobId: first.jobId, isReused: true });
    expect((await diagnostic("different-lifecycle-key")).status).toBe(freshStatus);
    expect(await jobCount()).toBe(1);
  });

  it("retains sharing admission while allowing the accepted identity to reconcile", async () => {
    const first = await accept("same-sharing-key");
    await pool().query("UPDATE printers SET shared_with_gateway = false WHERE id = $1", [f.printerId]);
    const replay = await diagnostic("same-sharing-key");
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ jobId: first.jobId, isReused: true });
    expect((await diagnostic("different-sharing-key")).status).toBe(409);
    expect(await jobCount()).toBe(1);
  });

  it.each(["manager", "agent"] as const)("refuses a fresh %s diagnostic while the Agent is offline", async (actor) => {
    await pool().query("UPDATE agents SET status = 'offline' WHERE id = $1", [f.agentId]);
    const response = await diagnostic("new-offline-diagnostic", actor);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AGENT_OFFLINE", retryable: true });
    expect(await jobCount()).toBe(0);
  });

  it.each(["manager", "agent"] as const)("returns an explicit conflict when a %s reuses a key for changed diagnostic content", async (actor) => {
    const first = await accept("changed-diagnostic-content", actor);
    await pool().query("UPDATE printers SET name = 'Renamed diagnostic printer' WHERE id = $1", [f.printerId]);
    const response = await diagnostic("changed-diagnostic-content", actor);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT", retryable: false });
    expect((await jobRow(first.jobId)).id).toBe(first.jobId);
    expect(await jobCount()).toBe(1);
    await accept("new-diagnostic-content", actor);
    expect(await jobCount()).toBe(2);
  });

  it("rechecks new diagnostic availability after the preflight Agent read", async () => {
    const original = db.query.agents.findFirst.bind(db.query.agents);
    vi.spyOn(db.query.agents, "findFirst").mockImplementationOnce((config) => {
      const query = original(config);
      const execute = query.execute.bind(query);
      vi.spyOn(query, "execute").mockImplementationOnce(async () => {
        const snapshot = await execute();
        await pool().query("UPDATE agents SET status = 'offline' WHERE id = $1", [f.agentId]);
        return snapshot;
      });
      return query;
    });
    const response = await diagnostic("disconnected-during-preflight");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AGENT_OFFLINE" });
    expect(await jobCount()).toBe(0);
  });

  it("preserves ordinary durable print admission for an offline active Agent", async () => {
    await pool().query("UPDATE agents SET status = 'offline' WHERE id = $1", [f.agentId]);
    const response = await ordinaryPrint(new Request("https://gateway.test/api/print/jobs", {
      method: "POST", headers: { "x-api-key": f.odooKey, "content-type": "application/json" },
      body: JSON.stringify({ printerId: f.printerId, documentType: "receipt", destination: f.destination,
        idempotencyKey: "ordinary-offline-operation", payload: { type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8=" } }),
    }));
    expect(response.status).toBe(201);
    expect(await jobCount()).toBe(1);
  });

  it.each(["manager", "agent"] as const)("never discloses another tenant's printer to a %s replay", async (actor) => {
    await accept("tenant-isolated-diagnostic", actor);
    const other = await seedFixture();
    expect((await diagnostic("tenant-isolated-diagnostic", actor, other.printerId)).status).toBe(404);
    expect(await jobCount()).toBe(1);
  });

  it.each(["membership", "user"] as const)("rechecks deleted %s authority before returning an accepted operation", async (removed) => {
    await accept("revoked-actor-diagnostic");
    const original = db.query.agents.findFirst.bind(db.query.agents);
    vi.spyOn(db.query.agents, "findFirst").mockImplementationOnce((config) => {
      const query = original(config);
      const execute = query.execute.bind(query);
      vi.spyOn(query, "execute").mockImplementationOnce(async () => {
        const snapshot = await execute();
        await pool().query("DELETE FROM tenant_users WHERE user_id = $1 AND tenant_id = $2", [userId, f.tenantId]);
        if (removed === "user") await pool().query("DELETE FROM users WHERE id = $1", [userId]);
        await pool().query("UPDATE agents SET status = 'offline' WHERE id = $1", [f.agentId]);
        return snapshot;
      });
      return query;
    });
    const response = await diagnostic("revoked-actor-diagnostic");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "MANAGER_AUTH_CHANGED" });
    expect(await jobCount()).toBe(1);
  });

  it("does not recreate a deleted printer from a retained diagnostic receipt", async () => {
    const first = await accept("removed-printer-diagnostic");
    const row = await jobRow(first.jobId);
    await pool().query(`INSERT INTO print_job_receipts
      (id, tenant_id, idempotency_key, printer_id, agent_id, destination, document_type, requested_by, fingerprint, status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'success',now(),now())`,
    [row.id, row.tenant_id, row.idempotency_key, row.printer_id, row.agent_id, row.destination, row.document_type, row.requested_by,
      idempotencyDigest({ printerId: row.printer_id, documentType: row.document_type, destination: row.destination, payload: row.payload })]);
    await pool().query("DELETE FROM job_events WHERE job_id = $1", [first.jobId]);
    await pool().query("DELETE FROM print_jobs WHERE id = $1", [first.jobId]);
    await pool().query("DELETE FROM printers WHERE id = $1", [f.printerId]);
    expect((await diagnostic("removed-printer-diagnostic")).status).toBe(404);
    expect(await jobCount()).toBe(0);
    expect((await pool().query("SELECT id FROM print_job_receipts WHERE id = $1", [first.jobId])).rows).toHaveLength(1);
  });
});
