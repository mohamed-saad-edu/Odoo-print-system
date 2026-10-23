import { randomBytes, randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
import { POST as enroll } from "../src/app/api/odoo/installations/auto/route";
import { applyMigrations, closePool, hasTestDatabase, insertQueuedJob, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";
import { makeV2OdooKey } from "../src/lib/odoo-idempotency";

const suite = describe.skipIf(!hasTestDatabase);

function attempt(apiKey: string, installationId: string, installationProof: string) {
  return enroll(new Request("https://gateway.test/api/odoo/installations/auto", {
    method: "POST",
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: JSON.stringify({ installationId, installationProof, name: "Automatic Odoo" }),
  }));
}

function credentials() {
  return { id: randomUUID(), proof: randomBytes(32).toString("base64url") };
}

suite("zero-touch Odoo installation enrollment (PostgreSQL)", () => {
  let fixture: Fixture;

  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();
  });

  it("registers a fresh strict-v2 tenant without customer cutover input", async () => {
    const who = credentials();
    const original = await pool().query("SELECT odoo_idempotency_mode AS mode FROM tenants WHERE id=$1", [fixture.tenantId]);
    expect(original.rows[0].mode).toBe("strict_v2");
    const created = await attempt(fixture.odooKey, who.id, who.proof);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ installationId: who.id, idempotencyVersion: 2, state: "created" });
    const state = await pool().query("SELECT odoo_idempotency_mode AS mode FROM tenants WHERE id=$1", [fixture.tenantId]);
    expect(state.rows[0].mode).toBe("strict_v2");
    const repeat = await attempt(fixture.odooKey, who.id, who.proof);
    expect(repeat.status).toBe(200);
    expect(await repeat.json()).toMatchObject({ installationId: who.id, idempotencyVersion: 2, state: "existing" });
    const rows = await pool().query("SELECT secret_hash FROM odoo_installations WHERE id=$1", [who.id]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].secret_hash).not.toContain(who.proof);
  });

  it("enrolls multiple independent Odoo databases using one API key without colliding", async () => {
    const a = credentials();
    const b = credentials();
    const results = await Promise.all([attempt(fixture.odooKey, a.id, a.proof), attempt(fixture.odooKey, b.id, b.proof)]);
    expect(results.map((response) => response.status)).toEqual([201, 201]);
    expect(makeV2OdooKey(a.id, "1", "receipt-100"))
      .not.toBe(makeV2OdooKey(b.id, "1", "receipt-100"));
    const associated = await pool().query("SELECT installation_id FROM odoo_installation_credentials WHERE tenant_id=$1 ORDER BY installation_id", [fixture.tenantId]);
    expect(associated.rows.map((row) => row.installation_id).sort()).toEqual([a.id,b.id].sort());
  });

  it("rejects a copied or wrong proof without modifying the registered owner", async () => {
    const a = credentials();
    const b = credentials();
    expect((await attempt(fixture.odooKey, a.id, a.proof)).status).toBe(201);
    const bad = await attempt(fixture.odooKey, a.id, b.proof);
    expect(bad.status).toBe(409);
    expect(await bad.json()).toMatchObject({ code: "INSTALLATION_OWNERSHIP_CONFLICT" });
    const repeat = await attempt(fixture.odooKey, a.id, a.proof);
    expect(repeat.status).toBe(200);
  });

  it("refuses automatic enrollment for an existing legacy tenant with prior Odoo jobs", async () => {
    await pool().query("UPDATE tenants SET odoo_idempotency_mode = 'legacy' WHERE id=$1", [fixture.tenantId]);
    const jobId = "legacy_auto_enrollment_history";
    await insertQueuedJob(fixture, jobId);
    const key = await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId]);
    await pool().query("UPDATE print_jobs SET api_key_id=$1 WHERE id=$2", [key.rows[0].id, jobId]);
    const a = credentials();
    const response = await attempt(fixture.odooKey, a.id, a.proof);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "RECONCILIATION_REQUIRED" });
    const mode = await pool().query("SELECT odoo_idempotency_mode AS mode FROM tenants WHERE id=$1", [fixture.tenantId]);
    expect(mode.rows[0].mode).toBe("legacy");
    const associations = await pool().query("SELECT id FROM odoo_installations WHERE tenant_id=$1", [fixture.tenantId]);
    expect(associations.rows).toHaveLength(0);
  });

  it("does not activate a workspace with a cancelled subscription", async () => {
    await pool().query("UPDATE tenant_subscriptions SET status='cancelled' WHERE tenant_id=$1", [fixture.tenantId]);
    const a = credentials();
    const response = await attempt(fixture.odooKey, a.id, a.proof);
    expect(response.status).toBe(403);
    const mode = await pool().query("SELECT odoo_idempotency_mode AS mode FROM tenants WHERE id=$1", [fixture.tenantId]);
    expect(mode.rows[0].mode).toBe("strict_v2");
  });
});
