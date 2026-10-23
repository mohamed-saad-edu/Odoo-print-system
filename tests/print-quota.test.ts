import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { queueOdooCapture } from "../src/lib/e2e-capture";
import { createPrintJobForPrinter } from "../src/lib/print-job-service";
import { POST as printJobsPOST } from "../src/app/api/print/jobs/route";
import { TenantEntitlementError, TenantPrintQuotaExceededError, getTenantPrintUsage } from "../src/lib/entitlements";
import { applyMigrations, closePool, hasTestDatabase, pool, seedFixture, truncateAll } from "./helpers/pg";

const suite = describe.skipIf(!hasTestDatabase);

function payload(label: string) {
  return { type: "raw", protocol: "raw", encoding: "base64", data: Buffer.from(label, "utf8").toString("base64") };
}

suite("tenant print quota", () => {
  beforeAll(async () => { await applyMigrations(); });
  afterAll(async () => { await closePool(); });
  beforeEach(async () => { await truncateAll(); });

  async function setPlanLimit(tenantId: string, limit: number | "unlimited") {
    const entitlements = { max_agents: "unlimited", max_printers: "unlimited", max_jobs_per_minute: "unlimited", max_concurrent_jobs: "unlimited", max_prints_per_period: limit };
    await pool().query(`UPDATE plans SET entitlements = $1::jsonb WHERE id = (SELECT plan_id FROM tenant_subscriptions WHERE tenant_id = $2)`, [JSON.stringify(entitlements), tenantId]);
  }

  it("locks the Agent before the integration key during print admission", async () => {
    const f = await seedFixture();
    const key = (await pool().query("SELECT id FROM api_keys WHERE tenant_id = $1", [f.tenantId])).rows[0].id;
    const blocker = await pool().connect();
    let print: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM agents WHERE id = $1 FOR UPDATE", [f.agentId]);
      const blockerPid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      print = createPrintJobForPrinter(f.printerId, payload("agent-key-order"), {
        tenantId: f.tenantId, requestedBy: "lock-order-test", rateLimitKeyId: key,
      }).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => Number((await pool().query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%agents%' AND $1 = ANY(pg_blocking_pids(pid))",
        [blockerPid],
      )).rows[0].n)).toBe(1);
      await blocker.query("SET LOCAL lock_timeout = '150ms'");
      // Agent capture claim uses this Agent -> key order. It must be able to
      // acquire the key while a concurrent print is waiting for its Agent.
      await expect(blocker.query("SELECT id FROM api_keys WHERE id = $1 FOR UPDATE", [key])).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await print;
    }
    expect(await print).toMatchObject({ value: expect.anything() });
  });

  it("admits concurrent capture and physical print without a subscription/runtime lock inversion", async () => {
    const f = await seedFixture();
    const key = (await pool().query("SELECT id FROM api_keys WHERE tenant_id = $1", [f.tenantId])).rows[0].id;
    const blocker = await pool().connect();
    const previousCaptureEnabled = process.env.YASEIR_E2E_CAPTURE_ENABLED;
    process.env.YASEIR_E2E_CAPTURE_ENABLED = "1";
    let capture: Promise<unknown> | undefined;
    let print: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`e2e_capture:tenant:${f.tenantId}`]);
      capture = queueOdooCapture({ id: key, tenantId: f.tenantId }, {
        agentId: f.agentId, idempotencyKey: "capture-lock-order-test", paperMm: 0,
        payload: { type: "pdf", encoding: "base64", data: "JVBERi0xLjQK" }, fingerprint: "capture-lock-order-test",
      }).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => Number((await pool().query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext($1)::oid",
        [`e2e_capture:tenant:${f.tenantId}`],
      )).rows[0].n)).toBe(1);
      const capturePid = (await pool().query(
        "SELECT pid FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext($1)::oid",
        [`e2e_capture:tenant:${f.tenantId}`],
      )).rows[0].pid;
      let printSettled = false;
      print = createPrintJobForPrinter(f.printerId, payload("concurrent-capture"), {
        tenantId: f.tenantId, requestedBy: "lock-order-test", idempotencyKey: "print-lock-order-test", rateLimitKeyId: key,
      }).then(value => ({ value }), error => ({ error })).finally(() => { printSettled = true; });
      await expect.poll(async () => printSettled || Number((await pool().query(
        "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%tenant_subscriptions%' AND $1 = ANY(pg_blocking_pids(pid))",
        [capturePid],
      )).rows[0].n) > 0).toBe(true);
      await blocker.query("COMMIT");
      const results = await Promise.all([capture, print]);
      expect(results).toEqual([expect.objectContaining({ value: expect.anything() }), expect.objectContaining({ value: expect.anything() })]);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await Promise.all([capture, print]);
      if (previousCaptureEnabled === undefined) delete process.env.YASEIR_E2E_CAPTURE_ENABLED;
      else process.env.YASEIR_E2E_CAPTURE_ENABLED = previousCaptureEnabled;
    }
  });

  it("enforces a finite print quota before the job row is inserted", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 20);

    for (let i = 1; i <= 20; i += 1) {
      const result = await createPrintJobForPrinter(f.printerId, payload(`quota-${i}`), {
        tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
        idempotencyKey: `quota-${i}`, expiresAt: new Date(Date.now() + 60_000),
      });
      expect(result.isReused).toBe(false);
    }

    await expect(createPrintJobForPrinter(f.printerId, payload("quota-21"), {
      tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
      idempotencyKey: "quota-21", expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toBeInstanceOf(TenantPrintQuotaExceededError);

    const usage = await getTenantPrintUsage(db, f.tenantId);
    expect(usage.limit).toBe(20);
    expect(usage.used).toBe(20);
    expect(usage.remaining).toBe(0);
    expect(Number((await pool().query("SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1", [f.tenantId])).rows[0].n)).toBe(20);
  });

  it("maps quota exhaustion to a structured HTTP 429 and never inserts the next job", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 1);

    const request = (key: string) => printJobsPOST(new Request("http://gateway.test/api/print/jobs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${f.odooKey}`,
        "content-type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify({
        printerId: f.printerId,
        destination: f.destination,
        documentType: "receipt",
        payload: payload("http-quota"),
      }),
    }));

    const first = await request("http-quota-1");
    expect(first.status).toBe(201);

    const second = await request("http-quota-2");
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body).toMatchObject({
      code: "PRINT_QUOTA_EXCEEDED",
      entitlement: "max_prints_per_period",
      limit: 1,
      used: 1,
      remaining: 0,
      upgradeRequired: true,
      retryable: false,
    });

    const count = Number((await pool().query(
      "SELECT COUNT(*)::int AS n FROM print_jobs WHERE tenant_id = $1",
      [f.tenantId],
    )).rows[0].n);
    expect(count).toBe(1);
  });

  it("does not double-consume a print credit when an idempotent retry reuses the same job", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 20);
    const options = {
      tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
      idempotencyKey: "quota-idempotent", expiresAt: new Date(Date.now() + 60_000),
    } as const;
    const first = await createPrintJobForPrinter(f.printerId, payload("same-print"), options);
    const second = await createPrintJobForPrinter(f.printerId, payload("same-print"), options);
    expect(second.isReused).toBe(true);
    expect(second.id).toBe(first.id);
    const usage = await getTenantPrintUsage(db, f.tenantId);
    expect(usage.used).toBe(1);
  });

  it("serializes concurrent admissions so the quota cannot be overshot", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 5);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => createPrintJobForPrinter(f.printerId, payload(`parallel-${i}`), {
      tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
      idempotencyKey: `parallel-${i}`, expiresAt: new Date(Date.now() + 60_000),
    })));
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(15);
    expect(rejected.every((r) => r.reason instanceof TenantPrintQuotaExceededError)).toBe(true);
    const usage = await getTenantPrintUsage(db, f.tenantId);
    expect(usage.used).toBe(5);
  });

  it("does not overshoot the per-minute job-rate entitlement under concurrent admissions", async () => {
    const f = await seedFixture();
    await pool().query(
      `UPDATE plans
       SET entitlements = jsonb_build_object(
         'max_agents', 'unlimited',
         'max_printers', 'unlimited',
         'max_jobs_per_minute', 5,
         'max_concurrent_jobs', 'unlimited',
         'max_prints_per_period', 'unlimited'
       )
       WHERE id = (SELECT plan_id FROM tenant_subscriptions WHERE tenant_id = $1)`,
      [f.tenantId],
    );

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createPrintJobForPrinter(f.printerId, payload(`rate-${i}`), {
          tenantId: f.tenantId,
          requestedBy: "rate-limit-test",
          documentType: "receipt",
          destination: f.destination,
          idempotencyKey: `rate-${i}`,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(15);
    expect(rejected.every((r) => r.reason instanceof Error && (r.reason as { entitlement?: string }).entitlement === "max_jobs_per_minute")).toBe(true);
    expect(Number((await pool().query(
      "SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1 AND created_at >= now() - interval '1 minute'",
      [f.tenantId],
    )).rows[0].n)).toBe(5);
  });

  it("does not overshoot the concurrent-job entitlement under concurrent admissions", async () => {
    const f = await seedFixture();
    await pool().query(
      `UPDATE plans
       SET entitlements = jsonb_build_object(
         'max_agents', 'unlimited',
         'max_printers', 'unlimited',
         'max_jobs_per_minute', 'unlimited',
         'max_concurrent_jobs', 3,
         'max_prints_per_period', 'unlimited'
       )
       WHERE id = (SELECT plan_id FROM tenant_subscriptions WHERE tenant_id = $1)`,
      [f.tenantId],
    );

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        createPrintJobForPrinter(f.printerId, payload(`concurrent-${i}`), {
          tenantId: f.tenantId,
          requestedBy: "concurrency-limit-test",
          documentType: "receipt",
          destination: f.destination,
          idempotencyKey: `concurrent-${i}`,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(17);
    expect(rejected.every((r) => r.reason instanceof Error && (r.reason as { entitlement?: string }).entitlement === "max_concurrent_jobs")).toBe(true);
    expect(Number((await pool().query(
      "SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1 AND status IN ('queued','claimed','printing') AND expires_at > now()",
      [f.tenantId],
    )).rows[0].n)).toBe(3);
  });

  it("counts an expired but unswept in-flight row against the concurrency limit", async () => {
    // A row that is still 'printing' but whose TTL has passed may still be
    // physically printing on the Agent. Excluding it from the count let a
    // tenant exceed max_concurrent_jobs by the number of unswept expired
    // rows, so the limit must include them until the sweeper terminalizes
    // them.
    const f = await seedFixture();
    await pool().query(
      `UPDATE plans
       SET entitlements = jsonb_build_object(
         'max_agents', 'unlimited',
         'max_printers', 'unlimited',
         'max_jobs_per_minute', 'unlimited',
         'max_concurrent_jobs', 1,
         'max_prints_per_period', 'unlimited'
       )
       WHERE id = (SELECT plan_id FROM tenant_subscriptions WHERE tenant_id = $1)`,
      [f.tenantId],
    );

    await createPrintJobForPrinter(f.printerId, payload("expired-inflight"), {
      tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
      idempotencyKey: "expired-inflight", expiresAt: new Date(Date.now() + 60_000),
    });
    // Age the row past its TTL while it is still in flight and unswept.
    await pool().query(
      "UPDATE print_jobs SET expires_at = now() - interval '1 minute', status = 'printing' WHERE tenant_id = $1",
      [f.tenantId],
    );

    await expect(createPrintJobForPrinter(f.printerId, payload("blocked-by-expired"), {
      tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination,
      idempotencyKey: "blocked-by-expired", expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toBeInstanceOf(TenantEntitlementError);

    expect(Number((await pool().query(
      "SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1", [f.tenantId],
    )).rows[0].n)).toBe(1);
  });

  it("does not charge a print whose explicit expiry elapsed while admission waited for its tenant lock", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 1);
    const blocker = await pool().connect();
    let result: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:tenant:${f.tenantId}`]);
      const clock = await blocker.query("SELECT clock_timestamp() AS now");
      const expiresAt = new Date(new Date(clock.rows[0].now).getTime() + 500);
      result = createPrintJobForPrinter(f.printerId, payload("expired-during-admission"), {
        tenantId: f.tenantId, requestedBy: "quota-test", idempotencyKey: "expired-during-admission", expiresAt,
      }).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => Number((await pool().query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext($1)::oid",
        [`print_jobs:tenant:${f.tenantId}`],
      )).rows[0].n)).toBe(1);
      await blocker.query("SELECT pg_sleep(0.75)");
      await blocker.query("COMMIT");
      expect(await result).toMatchObject({ error: { code: "INVALID_REQUEST" } });
      expect((await getTenantPrintUsage(db, f.tenantId)).used).toBe(0);
      expect(Number((await pool().query("SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id = $1", [f.tenantId])).rows[0].n)).toBe(0);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await result;
    }
  });

  it("starts a new quota bucket when Stripe advances the subscription period", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 2);
    const firstStart = new Date(Date.now() - 60_000);
    const firstEnd = new Date(Date.now() + 60_000);
    await pool().query("UPDATE tenant_subscriptions SET current_period_start = $1, current_period_end = $2 WHERE tenant_id = $3", [firstStart, firstEnd, f.tenantId]);
    await createPrintJobForPrinter(f.printerId, payload("period-1"), { tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination, idempotencyKey: "period-1" });

    const nextStart = new Date(Date.now() + 120_000);
    const nextEnd = new Date(Date.now() + 181_000);
    await pool().query("UPDATE tenant_subscriptions SET current_period_start = $1, current_period_end = $2 WHERE tenant_id = $3", [nextStart, nextEnd, f.tenantId]);
    await createPrintJobForPrinter(f.printerId, payload("period-2"), { tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination, idempotencyKey: "period-2" });

    const rows = await pool().query("SELECT period_start, used_prints FROM print_usage_periods WHERE tenant_id = $1 ORDER BY period_start", [f.tenantId]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r: { used_prints: number }) => Number(r.used_prints))).toEqual([1, 1]);
  });
});