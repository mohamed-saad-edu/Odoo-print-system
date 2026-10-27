import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readDetail } from "../src/app/api/jobs/[id]/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

describe.skipIf(!hasTestDatabase)("print job detail payload current tenant/session authority", () => {
  let fixture: Fixture, token: string, familyId: string;
  const jobId = "job-detail-live-authority";
  const request = (includePayload = true) => new Request(
    "https://gateway.test/api/jobs/" + jobId + (includePayload ? "?includePayload=1" : ""),
    { headers: { Authorization: "Bearer " + token } },
  );
  const get = (includePayload = true) => readDetail(request(includePayload), { params: Promise.resolve({ id: jobId }) });
  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", "job-detail-session-live-authority-fixture-32");
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
    await insertQueuedJob(fixture, jobId);
    const session = await createWorkspaceManagerTestSession(fixture.tenantId, { role: "owner" });
    token = session.token; familyId = session.familyId;
  });
  afterAll(async () => { await closePool(); vi.unstubAllEnvs(); });

  async function racedRead(change: "suspend" | "revoke"): Promise<Response> {
    const writer = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await writer.query("BEGIN");
      await writer.query("UPDATE tenants SET lifecycle=$2 WHERE id=$1",
        [fixture.tenantId, change === "suspend" ? "suspended" : "active"]);
      const pid = Number((await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = get();
      void pending.catch(() => undefined);
      // A preflight-only read leaks before the writer releases its row;
      // a fenced read must reach its own tenant FOR SHARE and wait.
      await expect.poll(async () => {
        const result = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()
            AND wait_event_type='Lock' AND query LIKE '%FROM tenants%'
            AND query LIKE '%FOR SHARE%' AND $1=ANY(pg_blocking_pids(pid))`, [pid],
        );
        return Number(result.rows[0]?.n ?? 0);
      }, { timeout: 8000, interval: 100 }).toBeGreaterThan(0);
      if (change === "revoke") {
        await pool().query("UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE family_id=$1", [familyId]);
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

  it("returns original print data only for explicit authorized inspector opt-in", async () => {
    const original = await get();
    expect(original.status).toBe(200);
    expect(original.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await original.json()).diagnosticPayload.data).toBe("aGVsbG8=");
    const redacted = await get(false);
    expect(redacted.status).toBe(200);
    const body = await redacted.json();
    expect(body.diagnosticPayload.data).toMatchObject({ redacted: true });
    expect(JSON.stringify(body)).not.toContain("aGVsbG8=");
  });
  it("rejects payload disclosure after concurrent tenant suspension", async () => {
    const res = await racedRead("suspend");
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ code: "TENANT_SUSPENDED" });
    expect(body).not.toHaveProperty("diagnosticPayload");
  });
  it("rejects payload disclosure after concurrent session revocation", async () => {
    const res = await racedRead("revoke");
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(body).not.toHaveProperty("diagnosticPayload");
  });
});
