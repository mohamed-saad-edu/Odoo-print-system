import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as lookup } from "../src/app/api/print/jobs/route";
import { GET as lookupV2 } from "../src/app/api/print/jobs/v2/route";
import { POST as batch } from "../src/app/api/print/jobs/batch-status/route";
import { makeLegacyOdooKey, makeV2OdooKey } from "../src/lib/odoo-idempotency";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

type Installation = { id: string; proof: string; job: string; key: string };
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

describe.skipIf(!hasTestDatabase)("Odoo status reads cannot downgrade installation authority", () => {
  let fixture: Fixture;
  let a: Installation;
  let b: Installation;

  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture({ odooIdempotencyMode: "strict_v2" });
    const keyId = (await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId])).rows[0].id;
    async function install(archived: boolean): Promise<Installation> {
      const id = randomUUID();
      const proof = randomBytes(32).toString("base64url");
      const job = `job_${randomUUID()}`;
      const key = makeV2OdooKey(id, "1", "same-external-order");
      await pool().query("INSERT INTO odoo_installations (id,tenant_id,name,secret_hash) VALUES ($1,$2,'Odoo test',$3)", [id, fixture.tenantId, sha256(proof)]);
      await pool().query("INSERT INTO odoo_installation_credentials (tenant_id,installation_id,api_key_id) VALUES ($1,$2,$3)", [fixture.tenantId,id,keyId]);
      await pool().query(`INSERT INTO odoo_v2_operations
        (tenant_id,installation_id,idempotency_key,legacy_key,source_company_id,source_operation_id,accepted_job_id)
        VALUES ($1,$2,$3,$4,'1','same-external-order',$5)`, [fixture.tenantId,id,key,makeLegacyOdooKey("1","same-external-order"),job]);
      if (archived) {
        await pool().query(`INSERT INTO print_job_receipts
          (id,tenant_id,idempotency_key,fingerprint,printer_id,agent_id,api_key_id,status,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,'success',now(),now())`, [job,fixture.tenantId,key,sha256(job),fixture.printerId,fixture.agentId,keyId]);
      } else {
        await pool().query(`INSERT INTO print_jobs
          (id,tenant_id,idempotency_key,printer_id,agent_id,api_key_id,status,payload,expires_at)
          VALUES ($1,$2,$3,$4,$5,$6,'queued','{"type":"raw","protocol":"raw","encoding":"base64","data":"aA=="}',now()+interval '1 hour')`,
        [job,fixture.tenantId,key,fixture.printerId,fixture.agentId,keyId]);
      }
      return { id, proof, job, key };
    }
    a = await install(false);
    b = await install(true);
  });

  function headers(who?: Installation): Record<string, string> {
    return { authorization: `Bearer ${fixture.odooKey}`, "content-type": "application/json",
      ...(who ? { "x-yaseir-odoo-idempotency-version": "2", "x-yaseir-odoo-installation": who.id, "x-yaseir-odoo-proof": who.proof } : {}) };
  }
  const get = (handler: typeof lookup, query: string, who?: Installation) => handler(new Request(`https://gateway.test/api/print/jobs?${query}`, { headers: headers(who) }));
  const post = (who?: Installation) => batch(new Request("https://gateway.test/api/print/jobs/batch-status", {
    method: "POST", headers: headers(who), body: JSON.stringify({ jobIds: [a.job,b.job] }),
  }));

  it.each([["legacy URL", lookup], ["v2 URL", lookupV2]] as const)("requires proof even when namespace headers are omitted on %s", async (_label, handler) => {
    expect((await get(handler,`id=${a.job}`)).status).toBe(403);
    expect((await get(handler,`idempotencyKey=${b.key}`)).status).toBe(403);
  });

  it.each([["legacy URL", lookup], ["v2 URL", lookupV2]] as const)("isolates live and archived status on %s", async (_label, handler) => {
    expect((await get(handler,`id=${a.job}`,a)).status).toBe(200);
    expect((await get(handler,`id=${b.job}`,b)).status).toBe(200);
    expect((await get(handler,`id=${b.job}`,a)).status).toBe(404);
    expect((await get(handler,`idempotencyKey=${a.key}`,b)).status).toBe(404);
  });

  it("requires proof on strict-v2 batch reads and rejects another installation's proof", async () => {
    expect((await post()).status).toBe(403);
    expect((await post({ ...a, proof: b.proof })).status).toBe(403);
  });

  it("filters batch responses to the proven installation including retained receipts", async () => {
    const responseA = await post(a);
    const responseB = await post(b);
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    expect((await responseA.json()).jobs.map((row: { jobId: string }) => row.jobId)).toEqual([a.job]);
    expect((await responseB.json()).jobs.map((row: { jobId: string }) => row.jobId)).toEqual([b.job]);
  });

  it("does not expose mapped v2 history through the legacy read path before cutover", async () => {
    await pool().query("UPDATE tenants SET odoo_idempotency_mode='legacy' WHERE id=$1", [fixture.tenantId]);
    for (const handler of [lookup,lookupV2]) {
      expect((await get(handler,`id=${a.job}`)).status).toBe(404);
      expect((await get(handler,`id=${b.job}`)).status).toBe(404);
    }
    expect((await (await post()).json()).jobs).toEqual([]);
  });

  it("revokes status access when an installation or credential is disabled", async () => {
    await pool().query("UPDATE odoo_installations SET enabled=false WHERE id=$1", [a.id]);
    expect((await get(lookup,`id=${a.job}`,a)).status).toBe(403);
    expect((await post(a)).status).toBe(403);
    await pool().query("UPDATE api_keys SET revoked_at=now() WHERE tenant_id=$1", [fixture.tenantId]);
    expect((await get(lookupV2,`id=${b.job}`,b)).status).toBe(401);
    expect((await post(b)).status).toBe(401);
  });
});
