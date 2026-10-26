import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool as gatewayPool } from "../src/db";
import { claimJobForDelivery, markJobDelivered, recordJobAck } from "../src/lib/job-delivery";
import { sweepPrintJobs } from "../src/lib/job-maintenance";
import { handleAgentMessage } from "../src/server/ws";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, jobRow, pool, seedFixture } from "./helpers/pg";

describe.skipIf(!hasTestDatabase)("WebSocket ACK durable tenant authority", () => {
  beforeAll(applyMigrations);
  afterAll(async () => { await closePool(); await gatewayPool.end(); });

  it.each(["active", "suspended", "deleted"])("accepts a delayed socket ACK only while tenant remains active (%s)", async lifecycle => {
    const fixture = await seedFixture();
    const jobId = `job-ack-tenant-${lifecycle}`;
    await insertQueuedJob(fixture, jobId);
    const claim = await claimJobForDelivery(jobId, fixture.agentId);
    expect(claim?.claimToken).toBeTruthy();
    await pool().query("UPDATE tenants SET lifecycle=$1 WHERE id=$2", [lifecycle, fixture.tenantId]);
    // The socket was authenticated before suspension; LISTEN close notifications
    // can be delayed or lost. Exercise the actual inbound message path.
    await handleAgentMessage(fixture.agentId, fixture.tenantId, JSON.stringify({ type: "job_ack", jobId, claimToken: claim!.claimToken }));
    const row = await jobRow(jobId);
    if (lifecycle === "active") expect(row.acked_at).not.toBeNull();
    else expect(row.acked_at).toBeNull();
    expect(row.status).toBe("claimed");
  });

  it.each(["claimed", "printing"])("duplicate admission ACKs do not renew a stalled %s lease", async status => {
    const fixture = await seedFixture();
    const jobId = `job-ack-replay-${status}`;
    await insertQueuedJob(fixture, jobId);
    const claim = await claimJobForDelivery(jobId, fixture.agentId);
    expect(await recordJobAck(jobId, fixture.tenantId, fixture.agentId, claim!.claimToken)).toBe(true);
    await pool().query("UPDATE print_jobs SET status=$1, updated_at=now()-interval '1 hour' WHERE id=$2", [status, jobId]);
    const before = await jobRow(jobId);

    await handleAgentMessage(fixture.agentId, fixture.tenantId, JSON.stringify({ type: "job_ack", jobId, claimToken: claim!.claimToken }));
    const after = await jobRow(jobId);
    expect(after.acked_at).toEqual(before.acked_at);
    expect(after.updated_at).toEqual(before.updated_at);
    await sweepPrintJobs({ agentId: fixture.agentId });
    const swept = await jobRow(jobId);
    expect(swept.status).toBe("failed");
    expect(swept.error).toMatch(/^(UNKNOWN_PARTIAL_DELIVERY|AGENT_EXECUTION_TIMEOUT)/);
    expect(swept.claim_token).toBe(claim!.claimToken);
  });

  it("an admission ACK arriving after printing progress does not renew execution", async () => {
    const fixture = await seedFixture();
    const jobId = "job-ack-after-progress";
    await insertQueuedJob(fixture, jobId);
    const claim = await claimJobForDelivery(jobId, fixture.agentId);
    await pool().query("UPDATE print_jobs SET status='printing', updated_at=now()-interval '1 hour' WHERE id=$1", [jobId]);
    const before = await jobRow(jobId);
    expect(await recordJobAck(jobId, fixture.tenantId, fixture.agentId, claim!.claimToken)).toBe(true);
    const after = await jobRow(jobId);
    expect(after.acked_at).not.toBeNull();
    expect(after.updated_at).toEqual(before.updated_at);
  });

  it.each(["claimed", "printing"])("replayed delivery evidence does not renew a stalled %s lease", async status => {
    const fixture = await seedFixture();
    const jobId = `job-delivery-replay-${status}`;
    await insertQueuedJob(fixture, jobId);
    const claim = await claimJobForDelivery(jobId, fixture.agentId);
    expect(await markJobDelivered(jobId, fixture.tenantId, fixture.agentId, claim!.claimToken)).toBe(true);
    await pool().query("UPDATE print_jobs SET status=$1, updated_at=now()-interval '1 hour' WHERE id=$2", [status, jobId]);
    const before = await jobRow(jobId);
    expect(await markJobDelivered(jobId, fixture.tenantId, fixture.agentId, claim!.claimToken)).toBe(true);
    const after = await jobRow(jobId);
    expect(after.delivered_at).toEqual(before.delivered_at);
    expect(after.updated_at).toEqual(before.updated_at);
  });
});
