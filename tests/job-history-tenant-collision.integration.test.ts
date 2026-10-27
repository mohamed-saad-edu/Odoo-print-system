import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
});
