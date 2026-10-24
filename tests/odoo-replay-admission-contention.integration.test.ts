import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { pool as runtimePool } from "../src/db";
import { POST as submitJob } from "../src/app/api/print/jobs/v2/route";
import { PATCH as reportJob } from "../src/app/api/agent/jobs/route";
import { claimJobForDelivery } from "../src/lib/job-delivery";
import { createPrintJobForPrinter } from "../src/lib/print-job-service";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll, type Fixture } from "./helpers/pg";

// Regression target: a previously accepted exact operation must not depend on
// unrelated *new-admission* quota serialization. New work must keep that barrier.
// All handlers, authorization, transactions and locks below are real; no mocks.
const suite = describe.skipIf(!hasTestDatabase);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 25));

type ErrorEvidence = { name: string; code: string | null; message: string };
function errorEvidence(error: unknown): ErrorEvidence[] {
  const result: ErrorEvidence[] = [];
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const value = current as { name?: string; code?: string; message?: string; cause?: unknown };
    result.push({ name: value.name ?? "Error", code: value.code ?? null,
      // Drizzle's wrapper can include query parameters. Keep only the actual
      // database diagnostic, never request credentials or document bytes.
      message: value.cause ? "Database wrapper; inspect nested cause" : String(value.message ?? current) });
    current = value.cause;
  }
  return result;
}

suite("accepted Odoo v2 replay versus unrelated tenant admission contention", () => {
  let fixture: Fixture;
  let keyId: string;
  let installationId: string;
  let proof: string;

  beforeAll(async () => {
    await applyMigrations();
    const settings = (await runtimePool.query("SELECT current_setting('lock_timeout') AS lock_timeout, current_setting('statement_timeout') AS statement_timeout, current_setting('idle_in_transaction_session_timeout') AS idle_transaction_timeout")).rows[0];
    console.info("REPLAY_CONTENTION_SETTINGS", JSON.stringify(settings));
    expect(settings).toEqual({ lock_timeout: "5s", statement_timeout: "30s", idle_transaction_timeout: "30s" });
  });
  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture({ odooIdempotencyMode: "strict_v2" });
    keyId = (await pool().query("SELECT id FROM api_keys WHERE tenant_id=$1", [fixture.tenantId])).rows[0].id;
    installationId = randomUUID();
    proof = randomBytes(32).toString("base64url");
    await pool().query("INSERT INTO odoo_installations(id,tenant_id,name,secret_hash,enabled) VALUES($1,$2,'Replay lock regression',$3,TRUE)",
      [installationId, fixture.tenantId, digest(proof)]);
    await pool().query("INSERT INTO odoo_installation_credentials(tenant_id,installation_id,api_key_id) VALUES($1,$2,$3)",
      [fixture.tenantId, installationId, keyId]);
  });
  afterAll(async () => { await closePool(); });

  function body(operation = "accepted-operation") {
    return { printerId: fixture.printerId, destination: fixture.destination, documentType: "receipt",
      payload: { type: "raw" as const, protocol: "raw" as const, encoding: "base64" as const, data: "cmVwbGF5LWxvY2stcmVncmVzc2lvbg==" },
      idempotencyVersion: 2 as const, installationId, sourceCompanyId: "1", sourceOperationId: operation,
      // Independent wire specification, not the production identity helper.
      idempotencyKey: digest(JSON.stringify(["yaseir-odoo-v2", installationId, "1", operation])) };
  }
  function request(value = body(), suppliedProof = proof) {
    return submitJob(new Request("https://gateway.test/api/print/jobs/v2", {
      method: "POST", headers: { authorization: `Bearer ${fixture.odooKey}`, "content-type": "application/json",
        "x-yaseir-odoo-proof": suppliedProof }, body: JSON.stringify(value),
    }));
  }
  function service(value = body()) {
    return createPrintJobForPrinter(value.printerId, value.payload, {
      tenantId: fixture.tenantId, requestedBy: "odoo", rateLimitKeyId: keyId,
      idempotencyKey: value.idempotencyKey, destination: value.destination, documentType: value.documentType,
      odooV2Identity: { version: 2, installationId, installationProof: proof,
        sourceCompanyId: value.sourceCompanyId, sourceOperationId: value.sourceOperationId,
        legacyKey: digest(`odoo:${value.sourceCompanyId}:${value.sourceOperationId}`), key: value.idempotencyKey },
    });
  }
  async function acceptedTerminal() {
    const response = await request();
    expect(response.status).toBe(201);
    const created = await response.json();
    const claim = await claimJobForDelivery(created.jobId, fixture.agentId);
    expect(claim?.claimToken).toBeTruthy();
    const terminal = await reportJob(new Request("https://gateway.test/api/agent/jobs", {
      method: "PATCH", headers: { authorization: fixture.agentAuth, "content-type": "application/json" },
      body: JSON.stringify({ jobId: created.jobId, claimToken: claim!.claimToken, status: "failed",
        error: "OPERATIONS_SYNTHETIC_NO_PRINT: regression fixture has no output backend" }),
    }));
    expect(terminal.status).toBe(200);
    expect(await terminal.json()).toMatchObject({ physicalOutcome: "not_printed" });
    return created.jobId as string;
  }
  async function state() {
    const jobs = (await pool().query(`SELECT id,agent_id,printer_id,status,delivery_attempts,retries,binding_digest,
      payload,idempotency_key,created_at,updated_at FROM print_jobs WHERE tenant_id=$1 ORDER BY id`, [fixture.tenantId])).rows;
    return { jobs: jobs.map(({ payload, ...job }) => ({ ...job, payloadSha256: digest(JSON.stringify(payload)) })),
      operations: (await pool().query(`SELECT installation_id,source_company_id,source_operation_id,idempotency_key,
        accepted_job_id FROM odoo_v2_operations WHERE tenant_id=$1 ORDER BY idempotency_key`, [fixture.tenantId])).rows,
      usage: (await pool().query("SELECT used_prints FROM print_usage_periods WHERE tenant_id=$1", [fixture.tenantId])).rows };
  }
  async function holdAdmission() {
    const blocker = await pool().connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:tenant:${fixture.tenantId}`]);
    const pid = Number((await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    return { blocker, pid };
  }
  async function observe<T>(promise: Promise<T>, blockerPid: number) {
    let settled = false;
    const watched = promise.then((value) => { settled = true; return value; }, (error: unknown) => { settled = true; throw error; });
    void watched.catch(() => {});
    const waits: Array<{ pid: number; wait_event_type: string; wait_event: string; blockers: number[] }> = [];
    const seen = new Set<number>();
    const deadline = Date.now() + 12_000;
    while (!settled && Date.now() < deadline) {
      const rows = await pool().query(`SELECT pid,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))`, [blockerPid]);
      for (const row of rows.rows) if (!seen.has(row.pid)) { seen.add(row.pid); waits.push(row); }
      if (!settled) await pause();
    }
    if (!settled) throw new Error("Replay/admission did not settle within its bounded observation window");
    return { value: await watched, waits };
  }
  async function release(blocker: PoolClient) {
    try { await blocker.query("ROLLBACK"); } finally { blocker.release(); }
  }

  it("returns the original exact terminal operation while an unrelated transaction owns the tenant admission lock", async () => {
    const jobId = await acceptedTerminal();
    const before = await state();
    expect(before.jobs).toMatchObject([{ id: jobId, status: "failed", delivery_attempts: 1, retries: 0 }]);
    expect(before.operations).toHaveLength(1);
    expect(before.usage).toEqual([{ used_prints: 1 }]);
    const { blocker, pid } = await holdAdmission();
    const started = performance.now();
    let pending: Promise<unknown> | undefined;
    try {
      // The service call retains the real nested PostgreSQL error; the HTTP
      // call proves the public result. Both repeat the SAME accepted operation.
      const calls = Promise.all([
        request().then(async (response) => ({ status: response.status, body: await response.json() })),
        service().then((result) => ({ result, errors: [] as ErrorEvidence[] }), (error: unknown) => ({ result: null, errors: errorEvidence(error) })),
      ]);
      pending = calls;
      const observed = await observe(calls, pid);
      const [http, direct] = observed.value;
      const held = (await blocker.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND granted")).rows[0].n;
      const after = await state();
      console.info("REPLAY_CONTENTION_EVIDENCE", JSON.stringify({ case: "accepted-replay", blockerPid: pid,
        elapsedMs: performance.now() - started, admissionLockStillHeld: held === 1, waits: observed.waits,
        http, service: direct, before, after, unchanged: JSON.stringify(before) === JSON.stringify(after) }));
      expect(held).toBe(1);
      expect(after).toEqual(before);
      expect(http.status, "Accepted replay must not wait for unrelated new-admission quota serialization").toBe(200);
      expect(http.body).toMatchObject({ jobId, status: "failed" });
      expect(direct.errors).toEqual([]);
      expect(direct.result).toMatchObject({ id: jobId, isReused: true });
    } finally {
      await release(blocker);
      await pending?.catch(() => {});
    }
  }, 20_000);

  it("keeps a new operation behind the tenant admission lock without a job, namespace or credit mutation", async () => {
    await acceptedTerminal();
    const before = await state();
    const { blocker, pid } = await holdAdmission();
    const started = performance.now();
    let pending: Promise<unknown> | undefined;
    try {
      const call = service(body("new-operation")).then((result) => ({ result, errors: [] as ErrorEvidence[] }),
        (error: unknown) => ({ result: null, errors: errorEvidence(error) }));
      pending = call;
      const observed = await observe(call, pid);
      const after = await state();
      console.info("REPLAY_CONTENTION_EVIDENCE", JSON.stringify({ case: "new-admission-control", blockerPid: pid,
        elapsedMs: performance.now() - started, waits: observed.waits, outcome: observed.value,
        unchanged: JSON.stringify(before) === JSON.stringify(after) }));
      expect(observed.waits.length).toBeGreaterThan(0);
      expect(observed.value.result).toBeNull();
      expect(observed.value.errors.some((error) => error.code === "55P03")).toBe(true);
      expect(after).toEqual(before);
    } finally {
      await release(blocker);
      await pending?.catch(() => {});
    }
  }, 20_000);

  it("rejects the formerly authorized credential after revocation without revealing or changing the accepted operation", async () => {
    await acceptedTerminal();
    const before = await state();
    await pool().query("UPDATE api_keys SET revoked_at=clock_timestamp(),read_only_until=NULL,odoo_enabled=FALSE WHERE id=$1", [keyId]);
    const response = await request();
    const responseBody = await response.json();
    const direct = await service().then((result) => ({ result, errors: [] as ErrorEvidence[] }),
      (error: unknown) => ({ result: null, errors: errorEvidence(error) }));
    const after = await state();
    console.info("REPLAY_CONTENTION_EVIDENCE", JSON.stringify({ case: "revocation-control", http: { status: response.status, body: responseBody },
      service: direct, unchanged: JSON.stringify(before) === JSON.stringify(after) }));
    expect(response.status).toBe(401);
    expect(responseBody).not.toHaveProperty("jobId");
    expect(direct.result).toBeNull();
    expect(direct.errors.some((error) => error.code === "UNAUTHORIZED")).toBe(true);
    expect(after).toEqual(before);
  });

  it.each(["installation-disabled", "proof-mismatch", "tenant-suspended", "mode-changed", "payload-mismatch"] as const)(
    "preserves the live authorization and exact-identity refusal: %s", async (kind) => {
      await acceptedTerminal();
      const before = await state();
      let value = body();
      let suppliedProof = proof;
      let expectedStatus = 403;
      let expectedCode: string | undefined = "INSTALLATION_NOT_ENROLLED";
      if (kind === "installation-disabled") await pool().query("UPDATE odoo_installations SET enabled=FALSE WHERE id=$1", [installationId]);
      if (kind === "proof-mismatch") suppliedProof = randomBytes(32).toString("base64url");
      if (kind === "tenant-suspended") {
        await pool().query("UPDATE tenants SET lifecycle='suspended' WHERE id=$1", [fixture.tenantId]);
        expectedStatus = 401; expectedCode = undefined;
      }
      if (kind === "mode-changed") {
        await pool().query("UPDATE tenants SET odoo_idempotency_mode='legacy' WHERE id=$1", [fixture.tenantId]);
        expectedStatus = 409; expectedCode = "CUTOVER_NOT_ACTIVE";
      }
      if (kind === "payload-mismatch") {
        value = { ...value, payload: { ...value.payload, data: "ZGlmZmVyZW50" } };
        expectedStatus = 409; expectedCode = "RECONCILIATION_REQUIRED";
      }
      const response = await request(value, suppliedProof);
      const responseBody = await response.json();
      expect(response.status).toBe(expectedStatus);
      if (expectedCode) expect(responseBody.code).toBe(expectedCode);
      expect(responseBody).not.toHaveProperty("jobId");
      expect(await state()).toEqual(before);
    });
});
