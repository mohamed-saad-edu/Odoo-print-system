import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { printJobs, printJobReceipts } from "../src/db/schema";
import { DELETE as cleanupDELETE } from "../src/app/api/jobs/route";
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

suite("manual job cleanup behavior (J-2)", () => {
  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("APP_BASE_URL", "https://cleanup.test");
    vi.stubEnv("GATEWAY_JWT_SECRET", gatewayTestSigningKey());
  });
  afterAll(async () => { await closePool(); vi.unstubAllEnvs(); });

  it("deletes only released terminal rows, preserves fenced/foreign/active work, and writes receipts", async () => {
    const f = await seedFixture();
    const g = await seedFixture();
    const session = await createWorkspaceManagerTestSession(f.tenantId);
    const claims = await verifyWorkspaceToken(session.token);
    expect(claims).toMatchObject({ ver: 2, kind: "manager", tenantId: f.tenantId, role: "owner" });
    vi.mocked(validateWorkspaceManager).mockResolvedValue(claims);
    const old = new Date(Date.now() - 3 * 24 * 3600_000);
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at, claim_token, error, updated_at)
       VALUES
       ('job_cleanup_ok', $1, $2, $3, 'success', $4::jsonb, now() + interval '1 hour', NULL, NULL, $5),
       ('job_cleanup_unknown', $1, $2, $3, 'failed', $4::jsonb, now() + interval '1 hour', 'live-claim-token', 'UNKNOWN_PARTIAL_DELIVERY: ambiguous', $5),
       ('job_cleanup_claimed', $1, $2, $3, 'claimed', $4::jsonb, now() + interval '1 hour', 'live-claim-token-2', 'DELIVERY_EVIDENCE_PENDING', now()),
       ('job_cleanup_other_tenant', $6, $7, $8, 'success', $4::jsonb, now() + interval '1 hour', NULL, NULL, $5)`,
      [f.tenantId, f.agentId, f.printerId, JSON.stringify(PAYLOAD), old, g.tenantId, g.agentId, g.printerId],
    );
    const res = await cleanupDELETE(new Request(
      `http://gateway.test/api/jobs?before=${encodeURIComponent(new Date(Date.now() - 24 * 3600_000).toISOString())}&limit=100&confirm=1`,
      { method: "DELETE" },
    ));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: number }).deleted).toBe(1);
    expect(await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cleanup_ok") })).toBeUndefined();
    const receipt = await db.query.printJobReceipts.findFirst({ where: eq(printJobReceipts.id, "job_cleanup_ok") });
    expect(receipt?.status).toBe("success");
    // Fenced unknown outcome, live claim, and foreign-tenant rows survive.
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cleanup_unknown") }))?.status).toBe("failed");
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cleanup_claimed") }))?.status).toBe("claimed");
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_cleanup_other_tenant") }))?.status).toBe("success");
  });
});
