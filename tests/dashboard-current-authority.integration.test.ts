import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

let token = "";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => token ? { value: token } : undefined }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
import { getDashboardState, getDashboardJobs } from "../src/app/actions";

describe.skipIf(!hasTestDatabase)("Dashboard server actions read behind live current-session authority", () => {
  let fixture: Fixture, familyId: string;
  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", "dashboard-live-auth-race-fixture-32-secret");
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
    await insertQueuedJob(fixture, "dashboard-race-job");
    const session = await createWorkspaceManagerTestSession(fixture.tenantId, { role: "owner" });
    token = session.token;
    familyId = session.familyId;
  });
  afterAll(async () => { token = ""; await closePool(); vi.unstubAllEnvs(); });

  it("returns scoped operational metadata and no raw job payload", async () => {
    const result = await getDashboardState();
    expect(result.agents).toEqual(expect.arrayContaining([expect.objectContaining({ id: fixture.agentId })]));
    expect(result.jobs).toEqual(expect.arrayContaining([expect.objectContaining({ id: "dashboard-race-job" })]));
    expect(result.jobs[0]).not.toHaveProperty("payload");
  });

  it.each([
    ["fleet", getDashboardState],
    ["job-history", getDashboardJobs],
  ] as const)("%s refuses data after an owner logout commits during the tenant fence", async (_name, operation) => {
    const blocker = await pool().connect();
    let committed = false;
    let pending: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE tenants SET lifecycle='active' WHERE id=$1", [fixture.tenantId]);
      const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = operation();
      void pending.catch(() => undefined);
      await expect.poll(async () => {
        const result = await pool().query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname=current_database() AND wait_event_type='Lock'
             AND query LIKE '%FROM tenants%' AND query LIKE '%FOR SHARE%'
             AND $1=ANY(pg_blocking_pids(pid))`, [pid],
        );
        return Number(result.rows[0]?.n ?? 0);
      }, { timeout: 8_000, interval: 100 }).toBeGreaterThan(0);
      await pool().query(
        "UPDATE refresh_tokens SET revoked_at=clock_timestamp() WHERE family_id=$1",
        [familyId],
      );
      await blocker.query("COMMIT");
      committed = true;
      await expect(pending).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    } finally {
      if (!committed) await blocker.query("ROLLBACK");
      blocker.release();
      await pending?.catch(() => undefined);
    }
  });
});
