import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { createPrintJobForPrinter, idempotencyDigest } from "../src/lib/print-job-service";
import { reserveV2Operation } from "../src/lib/odoo-v2-admission";
import { cleanupTerminalPrintJobs } from "../src/lib/job-maintenance";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const payload = { type: "raw" as const, protocol: "raw" as const, encoding: "base64" as const, data: "bGVnYWN5LXJlY2VpcHQ=" };

suite("accepted-only replay does not publish legacy namespace adoption", () => {
  let fixture: Fixture;
  let keyId: string;
  let jobId: string;
  let installationId: string;
  let installationProof: string;
  let fingerprint: string;
  const company = "1";
  const operation = "legacy-operation";
  const legacyKey = hash("odoo:1:legacy-operation");
  const v2Key = () => hash(JSON.stringify(["yaseir-odoo-v2", installationId, company, operation]));
  const identity = () => ({ version: 2 as const, installationId, installationProof,
    sourceCompanyId: company, sourceOperationId: operation, legacyKey, key: v2Key() });

  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture({ odooIdempotencyMode: "legacy" });
    keyId = (await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId])).rows[0].id;
    installationId = randomUUID(); installationProof = randomBytes(32).toString("base64url");
    await pool().query("INSERT INTO odoo_installations(id,tenant_id,name,secret_hash,enabled) VALUES($1,$2,'Accepted-only purity regression',$3,TRUE)",
      [installationId, fixture.tenantId, hash(installationProof)]);
    await pool().query("INSERT INTO odoo_installation_credentials(tenant_id,installation_id,api_key_id) VALUES($1,$2,$3)",
      [fixture.tenantId, installationId, keyId]);
    const original = await createPrintJobForPrinter(fixture.printerId, payload, {
      tenantId: fixture.tenantId, requestedBy: "odoo", rateLimitKeyId: keyId,
      idempotencyKey: legacyKey, documentType: "receipt", destination: fixture.destination,
    });
    jobId = original.id;
    // Explicit independently ordered canonical fixture: the tests do not use
    // the production fingerprint builder to manufacture their expected value.
    fingerprint = hash(JSON.stringify({ printerId: fixture.printerId, documentType: "receipt", destination: fixture.destination,
      payload: { data: "bGVnYWN5LXJlY2VpcHQ=", encoding: "base64", protocol: "raw", type: "raw" } }));
    // A previously approved operator resolution is fixture state. No v2
    // namespace is inserted by setup; the function under test must decide that.
    await pool().query(`INSERT INTO odoo_legacy_resolutions
      (tenant_id,installation_id,idempotency_key,legacy_key,disposition,legacy_job_id,legacy_fingerprint,approved_by)
      VALUES($1,$2,$3,$4,'reuse',$5,$6,'explicit-test-operator')`,
    [fixture.tenantId, installationId, v2Key(), legacyKey, jobId, fingerprint]);
    await pool().query("UPDATE tenants SET odoo_idempotency_mode='strict_v2' WHERE id=$1", [fixture.tenantId]);
  });
  afterAll(async () => { await closePool(); });

  async function snapshot() {
    return {
      jobs: (await pool().query("SELECT id,status,delivery_attempts,retries,idempotency_key,binding_digest FROM print_jobs WHERE tenant_id=$1 ORDER BY id", [fixture.tenantId])).rows,
      receipts: (await pool().query("SELECT id,status,idempotency_key,fingerprint,binding_digest FROM print_job_receipts WHERE tenant_id=$1 ORDER BY id", [fixture.tenantId])).rows,
      operations: (await pool().query("SELECT installation_id,source_company_id,source_operation_id,idempotency_key,accepted_job_id FROM odoo_v2_operations WHERE tenant_id=$1 ORDER BY idempotency_key", [fixture.tenantId])).rows,
      usage: (await pool().query("SELECT used_prints FROM print_usage_periods WHERE tenant_id=$1", [fixture.tenantId])).rows,
    };
  }
  function reserve(acceptedOnly = false) {
    const args: Parameters<typeof reserveV2Operation>[1] & { acceptedOnly?: true } = {
      tenantId: fixture.tenantId, apiKeyId: keyId, identity: identity(), requestedFingerprint: fingerprint,
      digest: idempotencyDigest, newJobId: null, ...(acceptedOnly ? { acceptedOnly: true as const } : {}),
    };
    return db.transaction((tx) => reserveV2Operation(tx, args));
  }

  it("returns a pure miss for an approved legacy alias without creating its v2 mapping or charging a credit", async () => {
    const before = await snapshot();
    expect(before.operations).toEqual([]);
    expect(before.jobs).toHaveLength(1);
    expect(before.usage).toEqual([{ used_prints: 1 }]);
    const result = await reserve(true);
    const after = await snapshot();
    console.info("ACCEPTED_REPLAY_PURITY", JSON.stringify({ case: "accepted-only-approved-alias", result, before, after }));
    expect(result, "Accepted-only lookup must not execute the legacy adoption branch").toBeNull();
    expect(after).toEqual(before);
  });

  it("retains explicit legacy adoption in the ordinary reservation path with no second print or credit", async () => {
    const before = await snapshot();
    const result = await reserve();
    const after = await snapshot();
    expect(result).toMatchObject({ jobId, isReused: true });
    expect(after.jobs).toEqual(before.jobs);
    expect(after.receipts).toEqual(before.receipts);
    expect(after.usage).toEqual(before.usage);
    expect(after.operations).toEqual([{ installation_id: installationId, source_company_id: company,
      source_operation_id: operation, idempotency_key: v2Key(), accepted_job_id: jobId }]);
  });

  it("releases lookup Agent and credential locks before a missing operation waits on quota admission", async () => {
    const before = await snapshot();
    const newOperation = "new-after-lookup-miss";
    const newKey = hash(JSON.stringify(["yaseir-odoo-v2", installationId, company, newOperation]));
    const blocker = await pool().connect();
    let pending: ReturnType<typeof createPrintJobForPrinter> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:tenant:${fixture.tenantId}`]);
      const blockerPid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      pending = createPrintJobForPrinter(fixture.printerId, payload, {
        tenantId: fixture.tenantId, requestedBy: "odoo", rateLimitKeyId: keyId,
        idempotencyKey: newKey, odooV2Identity: { ...identity(), sourceOperationId: newOperation,
          legacyKey: hash(`odoo:${company}:${newOperation}`), key: newKey },
        documentType: "receipt", destination: fixture.destination,
      });
      void pending.catch(() => {});
      await expect.poll(async () => (await pool().query(`SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event='advisory' AND $1=ANY(pg_blocking_pids(pid))`,
      [blockerPid])).rows[0].n, { timeout: 3000 }).toBe(1);
      // Only this test-owned checker uses a short deadline; Gateway sessions
      // retain their actual production timeout settings.
      await blocker.query("SET LOCAL lock_timeout='250ms'");
      expect((await blocker.query("SELECT id FROM agents WHERE id=$1 FOR UPDATE", [fixture.agentId])).rowCount).toBe(1);
      expect((await blocker.query("SELECT id FROM api_keys WHERE id=$1 FOR UPDATE", [keyId])).rowCount).toBe(1);
      expect(await snapshot()).toEqual(before);
      await blocker.query("ROLLBACK");
      const result = await pending;
      expect(result.isReused).toBe(false);
      const after = await snapshot();
      expect(after.jobs).toHaveLength(2);
      expect(after.operations).toEqual([{ installation_id: installationId, source_company_id: company,
        source_operation_id: newOperation, idempotency_key: newKey, accepted_job_id: result.id }]);
      expect(after.usage).toEqual([{ used_prints: 2 }]);
    } finally {
      try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
      await pending?.catch(() => {});
    }
  });

  it("reconciles an accepted strict-v2 retained receipt after its inventory owner is removed while admission is locked", async () => {
    await reserve(); // Explicit normal adoption creates the accepted mapping.
    // Advance only the fixture's retained history. The production retention
    // function creates the receipt and erases payload; the test never invents it.
    await pool().query(`UPDATE print_jobs SET status='failed',error='OPERATIONS_SYNTHETIC_NO_PRINT: historical fixture',
      updated_at=clock_timestamp()-interval '49 hours' WHERE id=$1`, [jobId]);
    expect(await cleanupTerminalPrintJobs()).toBe(1);
    await pool().query("DELETE FROM printers WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.printerId]);
    await pool().query("DELETE FROM agents WHERE tenant_id=$1 AND id=$2", [fixture.tenantId, fixture.agentId]);
    const before = await snapshot();
    expect(before.jobs).toEqual([]);
    expect(before.receipts).toMatchObject([{ id: jobId, fingerprint }]);
    const blocker = await pool().connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:tenant:${fixture.tenantId}`]);
      const result = await createPrintJobForPrinter(fixture.printerId, payload, {
        tenantId: fixture.tenantId, requestedBy: "odoo", rateLimitKeyId: keyId,
        idempotencyKey: v2Key(), odooV2Identity: identity(), documentType: "receipt", destination: fixture.destination,
      });
      expect(result).toMatchObject({ id: jobId, isReused: true, status: "failed" });
      expect(await snapshot()).toEqual(before);
    } finally { try { await blocker.query("ROLLBACK"); } finally { blocker.release(); } }
  }, 20_000);
});
