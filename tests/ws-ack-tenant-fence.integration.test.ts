import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool as gatewayPool } from "../src/db";
import { claimJobForDelivery } from "../src/lib/job-delivery";
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
});
