import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { printJobs } from "../src/db/schema";
import { POST as cancelPOST } from "../src/app/api/jobs/[id]/cancel/route";
import { validateWorkspaceManager, verifyWorkspaceToken } from "../src/lib/manager-auth";
import { applyMigrations, closePool, hasTestDatabase, truncateAll, seedFixture, pool } from "./helpers/pg";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";

vi.mock(import("../src/lib/manager-auth"), async (importOriginal) => ({
  ...(await importOriginal()),
  validateManager: vi.fn(),
  validateWorkspaceManager: vi.fn(),
}));
vi.mock("../src/lib/authorization", () => ({
  requireManagerPermission: vi.fn(),
  hasManagerPermission: vi.fn(() => true),
}));

const suite = describe.skipIf(!hasTestDatabase);
const PAYLOAD = { type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8=" };

/**
 * v5 P4: cancel refunds exactly once for queued jobs, never for claimed
 * jobs (v4 WP1, migration 0109; D4: queued cancels provably never printed
 * but consumed an admission credit, claimed cancels may have printed so
 * refunding them would enable create-claim-cancel farming).
 */
suite("job cancel quota refunds", () => {
  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("APP_BASE_URL", "https://cancel-refund.test");
    vi.stubEnv("GATEWAY_JWT_SECRET", gatewayTestSigningKey());
  });
  afterAll(async () => { await closePool(); vi.unstubAllEnvs(); });

  async function usage(tenantId: string) {
    const rows = await pool().query(
      `SELECT used_prints FROM print_monthly_usage WHERE tenant_id = $1`,
      [tenantId],
    );
    return rows.rows[0]?.used_prints as number | undefined;
  }

  async function cancelAs(f: Awaited<ReturnType<typeof seedFixture>>, jobId: string) {
    const session = await createWorkspaceManagerTestSession(f.tenantId);
    const claims = await verifyWorkspaceToken(session.token);
    vi.mocked(validateWorkspaceManager).mockResolvedValue(claims);
    const res = await cancelPOST(new Request(
      `http://gateway.test/api/jobs/${jobId}/cancel`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "operator test" }) },
    ), { params: Promise.resolve({ id: jobId }) } as never);
    return res;
  }

  async function insertJob(f: Awaited<ReturnType<typeof seedFixture>>, id: string, extra: string, params: unknown[]) {
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at${extra})
       VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, now() + interval '1 hour'${params.length > 0 ? ", " + params.map((_, i) => `$${6 + i}`).join(", ") : ""})`,
      [id, f.tenantId, f.agentId, f.printerId, JSON.stringify(PAYLOAD), ...params],
    );
  }

  it("refunds exactly once for a queued cancel, and a repeat cancel does not refund again", async () => {
    const f = await seedFixture();
    await insertJob(f, "job_cancel_queued", "", []);
    await pool().query(
      `INSERT INTO print_monthly_usage (tenant_id, period_start, period_end, used_prints)
       VALUES ($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 1)`,
      [f.tenantId],
    );
    const first = await cancelAs(f, "job_cancel_queued");
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ status: "canceled", quotaRefunded: true });
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cancel_queued") }))?.quotaRefunded).toBe(true);
    expect(await usage(f.tenantId)).toBe(0);
    const second = await cancelAs(f, "job_cancel_queued");
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ status: "canceled", alreadyCanceled: true, quotaRefunded: true });
    expect(await usage(f.tenantId)).toBe(0);
  });

  it("never refunds a claimed cancel and preserves the claim token with an unknown outcome", async () => {
    const f = await seedFixture();
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at, claim_token)
       VALUES ('job_cancel_claimed', $1, $2, $3, 'claimed', $4::jsonb, now() + interval '1 hour', 'live-claim-token')`,
      [f.tenantId, f.agentId, f.printerId, JSON.stringify(PAYLOAD)],
    );
    await pool().query(
      `INSERT INTO print_monthly_usage (tenant_id, period_start, period_end, used_prints)
       VALUES ($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 1)`,
      [f.tenantId],
    );
    const res = await cancelAs(f, "job_cancel_claimed");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "canceled", quotaRefunded: false });
    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cancel_claimed") });
    expect(row?.status).toBe("canceled");
    expect(row?.quotaRefunded).toBe(false);
    expect(row?.error).toMatch(/^UNKNOWN_PARTIAL_DELIVERY/);
    expect(row?.claimToken).toBe("live-claim-token");
    expect(await usage(f.tenantId)).toBe(1);
  });

  it("does not refund a queued row carrying delivery evidence (corrupt/legacy guard)", async () => {
    const f = await seedFixture();
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at, delivered_at)
       VALUES ('job_cancel_delivered', $1, $2, $3, 'queued', $4::jsonb, now() + interval '1 hour', now())`,
      [f.tenantId, f.agentId, f.printerId, JSON.stringify(PAYLOAD)],
    );
    await pool().query(
      `INSERT INTO print_monthly_usage (tenant_id, period_start, period_end, used_prints)
       VALUES ($1, date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', 1)`,
      [f.tenantId],
    );
    const res = await cancelAs(f, "job_cancel_delivered");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "canceled", quotaRefunded: false });
    expect(await usage(f.tenantId)).toBe(1);
  });

  it("returns 404 for another tenant's job", async () => {
    const f = await seedFixture();
    const g = await seedFixture();
    await insertJob(g, "job_cancel_foreign", "", []);
    const res = await cancelAs(f, "job_cancel_foreign");
    expect(res.status).toBe(404);
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cancel_foreign") }))?.status).toBe("queued");
  });
});
