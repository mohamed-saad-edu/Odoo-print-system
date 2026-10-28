import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, pool, seedFixture, truncateAll } from "./helpers/pg";
import { listPrintJobHistory } from "../src/lib/job-history";

/**
 * A live record in tenant B cannot shadow a durable receipt in tenant A,
 * even when their opaque job IDs happen to match across the two tables.
 * The collision is deliberate: PK uniqueness applies within each table,
 * not across the live and archived tables.
 */
describe.skipIf(!hasTestDatabase)("tenant-scoped durable print history", () => {
  beforeAll(applyMigrations);
  beforeEach(truncateAll);
  afterAll(closePool);

  it("treats unknown physical-outcome markers as literal prefixes, not LIKE patterns", async () => {
    const fixture = await seedFixture();
    const real = "real-execution-timeout";
    const lookalike = "lookalike-execution-timeout";
    const rows = [
      [real, "AGENT_EXECUTION_TIMEOUT: spooler result uncertain"],
      [lookalike, "AGENTxEXECUTIONxTIMEOUT: definite pre-dispatch failure"],
    ];
    for (const [id, error] of rows) {
      await pool().query(`
        INSERT INTO print_job_receipts
          (id, tenant_id, fingerprint, printer_id, agent_id, destination,
           document_type, status, error, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 'receipt', 'receipt', 'failed', $6,
                clock_timestamp(), clock_timestamp())
      `, [id, fixture.tenantId, "b".repeat(64), fixture.printerId, fixture.agentId, error]);
    }
    const uncertain = await listPrintJobHistory({ tenantId: fixture.tenantId, status: "unknown" });
    expect(uncertain.map(row => row.id)).toEqual([real]);
    expect(uncertain[0].physicalOutcome).toBe("unknown");
    const failed = await listPrintJobHistory({ tenantId: fixture.tenantId, status: "failed" });
    expect(failed.map(row => row.id)).toEqual([lookalike]);
    expect(failed[0].physicalOutcome).toBe("not_printed");
  });

  it("retains each workspace's job under a cross-table ID collision", async () => {
    const archived = await seedFixture();
    const live = await seedFixture();
    const id = "history-cross-tenant-collision";
    await pool().query(`
      INSERT INTO print_job_receipts
        (id, tenant_id, fingerprint, printer_id, agent_id,
         destination, document_type, status, output_medium, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'receipt', 'receipt', 'success',
              'physical', clock_timestamp(), clock_timestamp())
    `, [id, archived.tenantId, "a".repeat(64), archived.printerId, archived.agentId]);
    await insertQueuedJob(live, id);

    const archivedRows = await listPrintJobHistory({ tenantId: archived.tenantId });
    expect(archivedRows).toHaveLength(1);
    expect(archivedRows[0]).toMatchObject({ id, tenantId: archived.tenantId, archived: true, status: "success" });
    const liveRows = await listPrintJobHistory({ tenantId: live.tenantId });
    expect(liveRows).toHaveLength(1);
    expect(liveRows[0]).toMatchObject({ id, tenantId: live.tenantId, archived: false, status: "queued" });
    const allRows = await listPrintJobHistory({ limit: 10 });
    expect(allRows.filter(row => row.id === id)).toHaveLength(2);
  });
  it("orders platform pagination deterministically when tenant IDs collide on job ID and timestamp", async () => {
    const archived = await seedFixture();
    const live = await seedFixture();
    const jobId = "same-id-same-time";
    const at = "2026-01-17T10:00:00.000Z";
    await pool().query(`
      INSERT INTO print_job_receipts
        (id, tenant_id, fingerprint, printer_id, agent_id, destination,
         document_type, status, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'receipt', 'receipt', 'success', $6, $6)
    `, [jobId, archived.tenantId, "c".repeat(64), archived.printerId, archived.agentId, at]);
    await insertQueuedJob(live, jobId);
    await pool().query("UPDATE print_jobs SET created_at = $1, updated_at = $1 WHERE id = $2 AND tenant_id = $3",
      [at, jobId, live.tenantId]);
    const first = await listPrintJobHistory({ limit: 1, offset: 0 });
    const second = await listPrintJobHistory({ limit: 1, offset: 1 });
    const order = [archived.tenantId, live.tenantId].sort().reverse();
    expect([first[0]?.tenantId, second[0]?.tenantId]).toEqual(order);
    expect(new Set([first[0]?.tenantId, second[0]?.tenantId]).size).toBe(2);
  });


  it("uses tenant ID as the final global-history sort key for stable offset pagination", () => {
    const source = readFileSync("src/lib/job-history.ts", "utf8");
    expect(source).toContain("ORDER BY h.created_at DESC, h.id DESC, h.tenant_id DESC");
  });

});
