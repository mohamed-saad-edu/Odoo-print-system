import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "../src/db";
import { printJobs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";
import { PATCH as patchAgentJob } from "../src/app/api/agent/jobs/route";

/**
 * v5 P4: submission evidence through the agent report path.
 * - Evidence is valid ONLY for a successful physical job (the Gateway
 *   answers 422 SUBMISSION_EVIDENCE_MISMATCH on any other report).
 * - A physical success with positive query evidence derives 'completed'.
 */
const suite = describe.skipIf(!hasTestDatabase);

suite("submission evidence on agent reports", () => {
  let f: Awaited<ReturnType<typeof seedFixture>>;

  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => {
    await truncateAll();
    f = await seedFixture();
  });

  async function report(jobId: string, body: Record<string, unknown>) {
    return patchAgentJob(new Request("https://gateway.test/api/agent/jobs", {
      method: "PATCH",
      headers: { Authorization: f.agentAuth, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
  }

  async function insertClaimedJob(id: string, outputMedium: string) {
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at, claim_token, output_medium)
       VALUES ($1, $2, $3, $4, 'claimed', $5::jsonb, now() + interval '1 hour', 'claim-evidence-1', $6)`,
      [id, f.tenantId, f.agentId, f.printerId, JSON.stringify({ type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8=" }), outputMedium],
    );
  }

  it("rejects submission evidence on a non-success report with 422", async () => {
    await insertClaimedJob("job_evidence_failed", "physical");
    const res = await report("job_evidence_failed", {
      jobId: "job_evidence_failed", claimToken: "claim-evidence-1", status: "failed",
      submissionEvidence: { verificationSource: "query", windowsJobStatus: ["PRINTED"] },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: "SUBMISSION_EVIDENCE_MISMATCH" });
    expect((await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_evidence_failed") }))?.status).toBe("claimed");
  });

  it("accepts positive query evidence on a physical success and derives completed", async () => {
    await insertClaimedJob("job_evidence_physical", "physical");
    const res = await report("job_evidence_physical", {
      jobId: "job_evidence_physical", claimToken: "claim-evidence-1", status: "success",
      submissionEvidence: { verificationSource: "query", windowsJobStatus: ["PRINTED"] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "success", submissionState: "completed" });
    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_evidence_physical") });
    expect(row?.status).toBe("success");
    expect(row?.submissionEvidence).toMatchObject({ verificationSource: "query" });
  });

  it("keeps an old-agent success without evidence at submitted", async () => {
    await insertClaimedJob("job_evidence_old_agent", "physical");
    const res = await report("job_evidence_old_agent", {
      jobId: "job_evidence_old_agent", claimToken: "claim-evidence-1", status: "success",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "success", submissionState: "submitted" });
  });
});
