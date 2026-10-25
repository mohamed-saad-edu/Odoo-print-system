import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as lookup } from "../src/app/api/print/jobs/route";
import { GET as lookupV2 } from "../src/app/api/print/jobs/v2/route";
import { POST as batch } from "../src/app/api/print/jobs/batch-status/route";
import { makeLegacyOdooKey, makeV2OdooKey } from "../src/lib/odoo-idempotency";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 10));
const readers = [
  { name: "legacy URL", handler: lookup, batch: false },
  { name: "v2 URL", handler: lookupV2, batch: false },
  { name: "batch", handler: batch, batch: true },
] as const;
type Reader = typeof readers[number];

describe.skipIf(!hasTestDatabase)("Odoo status authority stays locked through metadata reads", () => {
  let fixture: Fixture;
  let installationId: string;
  let proof: string;
  let keyId: string;
  let jobId: string;

  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture({ odooIdempotencyMode: "strict_v2" });
    installationId = randomUUID();
    proof = randomBytes(32).toString("base64url");
    jobId = `job_${randomUUID()}`;
    keyId = (await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId])).rows[0].id;
    const operation = makeV2OdooKey(installationId, "1", "concurrent-read");
    await pool().query("INSERT INTO odoo_installations (id,tenant_id,name,secret_hash) VALUES ($1,$2,'Concurrency fixture',$3)",
      [installationId, fixture.tenantId, sha256(proof)]);
    await pool().query("INSERT INTO odoo_installation_credentials (tenant_id,installation_id,api_key_id) VALUES ($1,$2,$3)",
      [fixture.tenantId, installationId, keyId]);
    await pool().query(`INSERT INTO print_jobs
      (id,tenant_id,idempotency_key,printer_id,agent_id,api_key_id,status,payload,expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,'queued','{"type":"raw","protocol":"raw","encoding":"base64","data":"aA=="}',now()+interval '1 hour')`,
      [jobId, fixture.tenantId, operation, fixture.printerId, fixture.agentId, keyId]);
    await pool().query(`INSERT INTO odoo_v2_operations
      (tenant_id,installation_id,idempotency_key,legacy_key,source_company_id,source_operation_id,accepted_job_id)
      VALUES ($1,$2,$3,$4,'1','concurrent-read',$5)`,
      [fixture.tenantId, installationId, operation, makeLegacyOdooKey("1", "concurrent-read"), jobId]);
  });

  function request(reader: Reader, legacy = false, rawKey = fixture.odooKey) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${rawKey}`, "content-type": "application/json",
      ...(!legacy ? {
        "x-yaseir-odoo-idempotency-version": "2",
        "x-yaseir-odoo-installation": installationId,
        "x-yaseir-odoo-proof": proof,
      } : {}),
    };
    return reader.handler(new Request(
      `https://gateway.test/api/print/jobs${reader.batch ? "/batch-status" : `?id=${jobId}`}`,
      { headers, ...(reader.batch ? { method: "POST", body: JSON.stringify({ jobIds: [jobId] }) } : {}) },
    ));
  }

  async function awaitMetadataRead(lockerPid: number): Promise<number> {
    const deadline = Date.now() + 4_000;
    while (Date.now() < deadline) {
      const blocked = await pool().query<{ pid: number }>(`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
          AND $1 = ANY(pg_blocking_pids(pid))
          AND lower(query) LIKE '%select%' AND query LIKE '%print_jobs%'
          AND query NOT LIKE '%pg_stat_activity%'`, [lockerPid]);
      if (blocked.rows[0]) return blocked.rows[0].pid;
      await pause();
    }
    throw new Error("Status request did not reach the deliberately blocked metadata SELECT");
  }

  async function assertReadFencesMutation(reader: Reader, mutationSql: string, values: string[], deniedStatus: number, legacy = false) {
    const locker = await pool().connect();
    const mutator = await pool().connect();
    let read: Promise<Response> | undefined;
    let mutation: Promise<unknown> | undefined;
    try {
      const lockerPid = Number((await locker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      const mutatorPid = Number((await mutator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE print_jobs IN ACCESS EXCLUSIVE MODE");
      read = request(reader, legacy);
      // Observe the actual PostgreSQL lock barrier, not an assumed sleep or a
      // mocked transaction callback. Consume rejection in cleanup as well.
      void read.catch(() => {});
      const readerPid = await awaitMetadataRead(lockerPid);
      let settled = false;
      mutation = mutator.query(mutationSql, values).finally(() => { settled = true; });
      void mutation.catch(() => {});
      let blockedByReader = false;
      const deadline = Date.now() + 3_000;
      while (!settled && Date.now() < deadline) {
        const state = await pool().query<{ blockers: number[] }>(
          "SELECT pg_blocking_pids($1) AS blockers", [mutatorPid],
        );
        if (state.rows[0]?.blockers.includes(readerPid)) {
          blockedByReader = true;
          break;
        }
        await pause();
      }
      expect(blockedByReader, "authority mutation must wait for the same transaction that is reading job metadata").toBe(true);
      expect(settled, "authority must not commit after proof validation but before metadata read").toBe(false);
      await locker.query("COMMIT");
      const response = await read;
      expect(response.status).toBe(200);
      const body = await response.json();
      expect((reader.batch ? body.jobs : [body]).map((row: { jobId: string }) => row.jobId)).toEqual([jobId]);
      await mutation;
      expect((await request(reader, legacy)).status).toBe(deniedStatus);
    } finally {
      // Always release the table barrier before awaiting either worker; a red
      // assertion must not strand clients or contaminate the next fixture.
      await locker.query("ROLLBACK").catch(() => {});
      await Promise.allSettled([read, mutation].filter((value) => value !== undefined));
      mutator.release();
      locker.release();
    }
  }

  for (const reader of readers) {
    it(`${reader.name}: installation disable waits until the authorized metadata read completes`, async () => {
      await assertReadFencesMutation(reader, "UPDATE odoo_installations SET enabled=false WHERE id=$1", [installationId], 403);
    });

    it(`${reader.name}: credential association removal waits until the authorized metadata read completes`, async () => {
      await assertReadFencesMutation(reader,
        "DELETE FROM odoo_installation_credentials WHERE tenant_id=$1 AND installation_id=$2 AND api_key_id=$3",
        [fixture.tenantId, installationId, keyId], 403);
    });

    it(`${reader.name}: key revocation waits until the authorized metadata read completes`, async () => {
      await assertReadFencesMutation(reader,
        "UPDATE api_keys SET revoked_at=clock_timestamp(), read_only_until=NULL WHERE id=$1", [keyId], 401);
    });

    it(`${reader.name}: tenant suspension waits until the authorized metadata read completes`, async () => {
      await assertReadFencesMutation(reader, "UPDATE tenants SET lifecycle='suspended' WHERE id=$1", [fixture.tenantId], 401);
    });

    it(`${reader.name}: legacy cutover cannot straddle a historical metadata read`, async () => {
      await pool().query("DELETE FROM odoo_v2_operations WHERE accepted_job_id=$1", [jobId]);
      await pool().query("UPDATE tenants SET odoo_idempotency_mode='legacy' WHERE id=$1", [fixture.tenantId]);
      await assertReadFencesMutation(reader, "UPDATE tenants SET odoo_idempotency_mode='strict_v2' WHERE id=$1", [fixture.tenantId], 403, true);
    });
  }

  it("keeps rotation read-only grace and the replacement credential authorized for historical status", async () => {
    const replacement = `odoo_${randomBytes(32).toString("base64url")}`;
    const replacementId = `key_${randomUUID()}`;
    await pool().query(`INSERT INTO api_keys (id,tenant_id,name,hashed_key,odoo_enabled,odoo_enabled_revision)
      VALUES ($1,$2,'Rotated fixture',$3,true,0)`, [replacementId, fixture.tenantId, sha256(replacement)]);
    await pool().query(`INSERT INTO odoo_installation_credentials (tenant_id,installation_id,api_key_id)
      SELECT tenant_id,installation_id,$1 FROM odoo_installation_credentials WHERE api_key_id=$2`, [replacementId, keyId]);
    await pool().query(`UPDATE api_keys SET revoked_at=clock_timestamp()-interval '1 second',
      read_only_until=clock_timestamp()+interval '1 hour' WHERE id=$1`, [keyId]);
    for (const reader of readers) {
      expect((await request(reader)).status).toBe(200);
      expect((await request(reader, false, replacement)).status).toBe(200);
    }
    await pool().query("UPDATE api_keys SET read_only_until=clock_timestamp()-interval '1 second' WHERE id=$1", [keyId]);
    for (const reader of readers) {
      expect((await request(reader)).status).toBe(401);
      expect((await request(reader, false, replacement)).status).toBe(200);
    }
  });
});
