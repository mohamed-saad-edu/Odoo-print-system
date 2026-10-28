import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listMembers } from "../src/app/api/team/members/route";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

suite("workspace member directory live authority fence", () => {
  let fixture: Fixture;
  let access: string;
  let familyId: string;

  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", "directory-fence-fixture-secret-minimum-32");
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
    const session = await createWorkspaceManagerTestSession(fixture.tenantId, { role: "owner" });
    access = session.token;
    familyId = session.familyId;
  });
  afterAll(async () => {
    await closePool();
    vi.unstubAllEnvs();
  });

  const request = () => new Request("https://gateway.test/api/team/members", {
    headers: { authorization: `Bearer ${access}` },
  });

  async function blockedMemberRequest(change: "suspend" | "revoke") {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle=$2 WHERE id=$1", [
        fixture.tenantId, change === "suspend" ? "suspended" : "active",
      ]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = listMembers(request());
      void pending.catch(() => undefined);

      // The member reader must reach a tenant FOR SHARE fence. The old
      // direct-list implementation responds with member emails without ever
      // waiting here after the initial (non-locking) session preflight.
      await expect.poll(async () => {
        const waiting = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
             AND $1 = ANY(pg_blocking_pids(pid))`, [blockerPid],
        );
        return Number(waiting.rows[0]?.n ?? 0);
      }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);

      if (change === "revoke") {
        await pool().query(
          "UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE family_id=$1",
          [familyId],
        );
      }
      await blocker.query("COMMIT");
      committed = true;
      return await pending;
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  }

  it("lists only workspace members for an active owner session", async () => {
    const response = await listMembers(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.members).toEqual(expect.arrayContaining([expect.objectContaining({
      role: "owner",
    })]));
  });

  it("does not expose member emails after tenant suspension commits during authentication", async () => {
    const response = await blockedMemberRequest("suspend");
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "TENANT_SUSPENDED" });
  });

  it("does not expose member emails after its authenticated session is revoked", async () => {
    const response = await blockedMemberRequest("revoke");
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
  });
});
