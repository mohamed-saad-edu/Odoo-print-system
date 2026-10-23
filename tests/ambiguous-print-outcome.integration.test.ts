import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "../src/db";
import { printJobs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";
import {
  claimJobForDelivery,
  markJobDelivered,
  markJobDeliveryUnknown,
  releaseUndeliveredClaim,
} from "../src/lib/job-delivery";
import { sweepPrintJobs } from "../src/lib/job-maintenance";
import { agentStaleThresholdSeconds } from "../src/lib/stale-threshold";

/**
 * PP-02: the printing safety invariant.
 *
 * 1. A job accepted but not provably delivered stays ambiguous.
 * 2. An ambiguous print is NEVER automatically retried.
 * 3. A real delivery keeps valid delivery evidence.
 * 4. Reconciliation still converges for the same fenced attempt.
 * 5. No job is silently lost, incorrectly marked delivered, or printed twice.
 */
const suite = describe.skipIf(!hasTestDatabase);

suite("ambiguous print outcomes never duplicate paper", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => { await truncateAll(); });

  async function queuedJob(id: string) {
    await pool().query(
      `INSERT INTO print_jobs (id, tenant_id, agent_id, printer_id, status, payload, expires_at)
       VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, now() + interval '1 hour')`,
      [id, f.tenantId, f.agentId, f.printerId, JSON.stringify({ type: "raw", protocol: "raw", encoding: "base64", data: "aGVsbG8=" })],
    );
  }

  let f: Awaited<ReturnType<typeof seedFixture>>;

  beforeEach(async () => {
    await truncateAll();
    f = await seedFixture();
  });

  it("an ambiguous outcome stays ambiguous and is never requeued", async () => {
    await queuedJob("job_ambiguous_01");
    const claim = await claimJobForDelivery("job_ambiguous_01", f.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const claimToken = claim!.claimToken!;

    // The socket accepted the frame but the evidence write failed: the
    // physical outcome is unknown.
    const marked = await markJobDeliveryUnknown("job_ambiguous_01", f.tenantId, f.agentId, claimToken);
    expect(marked).toBe(true);

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_ambiguous_01") });
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/^UNKNOWN_PARTIAL_DELIVERY/);
    // The execution fence is preserved so the exact attempt can reconcile.
    expect(row?.claimToken).not.toBeNull();
  });

  it("an ambiguous outcome is never requeued by the sweeper", async () => {
    await queuedJob("job_ambiguous_02");
    const claim = await claimJobForDelivery("job_ambiguous_02", f.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const claimToken = claim!.claimToken!;
    await markJobDeliveryUnknown("job_ambiguous_02", f.tenantId, f.agentId, claimToken);

    // Age the row past the claim-lease threshold and sweep.
    await pool().query(
      `UPDATE print_jobs SET updated_at = now() - make_interval(secs => $1) WHERE id = 'job_ambiguous_02'`,
      [agentStaleThresholdSeconds() + 30],
    );
    await sweepPrintJobs();

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_ambiguous_02") });
    // It stays terminal-failed with an unknown marker. It is NEVER returned to
    // the queued state, which is what would let it print twice.
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/^UNKNOWN_PARTIAL_DELIVERY/);
    expect(row?.status).not.toBe("queued");
  });

  it("a real delivery keeps valid delivery evidence", async () => {
    await queuedJob("job_real_delivery_01");
    const claim = await claimJobForDelivery("job_real_delivery_01", f.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const claimToken = claim!.claimToken!;

    const delivered = await markJobDelivered("job_real_delivery_01", f.tenantId, f.agentId, claimToken);
    expect(delivered).toBe(true);

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_real_delivery_01") });
    expect(row?.deliveredAt).not.toBeNull();
    expect(row?.status).toBe("claimed");
  });

  it("a delivered job that goes silent is never requeued", async () => {
    await queuedJob("job_delivered_silent_01");
    const claim = await claimJobForDelivery("job_delivered_silent_01", f.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const claimToken = claim!.claimToken!;
    await markJobDelivered("job_delivered_silent_01", f.tenantId, f.agentId, claimToken);

    await pool().query(
      `UPDATE print_jobs SET updated_at = now() - make_interval(secs => $1) WHERE id = 'job_delivered_silent_01'`,
      [agentStaleThresholdSeconds() + 30],
    );
    await sweepPrintJobs();

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_delivered_silent_01") });
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/^UNKNOWN_PARTIAL_DELIVERY/);
    expect(row?.status).not.toBe("queued");
  });

  it("a provably undelivered claim is safely requeued and can print once", async () => {
    // No delivery evidence at all: the Agent provably never received the job,
    // so requeueing it cannot duplicate paper.
    await queuedJob("job_undelivered_01");
    const claim = await claimJobForDelivery("job_undelivered_01", f.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const claimToken = claim!.claimToken!;

    const outcome = await releaseUndeliveredClaim(
      "job_undelivered_01", f.tenantId, f.agentId, claimToken, "safe pre-dispatch release",
    );
    expect(outcome).toBe("requeued");

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_undelivered_01") });
    expect(row?.status).toBe("queued");
    expect(row?.deliveredAt).toBeNull();
    expect(row?.ackedAt).toBeNull();
  });

  it("a job is never both requeued and kept as an unknown attempt", async () => {
    // The ambiguity marker and the requeue are mutually exclusive states: a
    // row can only be in one of them, so a job can never be printed twice.
    await queuedJob("job_exclusive_01");
    const claim = await claimJobForDelivery("job_exclusive_01", f.agentId);
    const claimToken = claim!.claimToken!;
    await markJobDeliveryUnknown("job_exclusive_01", f.tenantId, f.agentId, claimToken);
    const release = await releaseUndeliveredClaim(
      "job_exclusive_01", f.tenantId, f.agentId, claimToken, "release after unknown",
    );
    expect(release).toBe("noop");

    const row = await db.query.printJobs.findFirst({ where: eq(printJobs.id, "job_exclusive_01") });
    expect(row?.status).toBe("failed");
    expect(row?.error).toMatch(/^UNKNOWN_PARTIAL_DELIVERY/);
  });
});
