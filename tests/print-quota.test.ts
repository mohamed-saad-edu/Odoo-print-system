import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "../src/db";
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
      // Keep admission lock order compatible with key mutation under contention.
      await expect(blocker.query("SELECT id FROM api_keys WHERE id = $1 FOR UPDATE", [key])).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      await print;
    }
    expect(await print).toMatchObject({ value: expect.anything() });
  });

  it("uses UTC calendar-month credits regardless of first activation and contract dates", async () => {
    const f = await seedFixture();
    await pool().query(
      "UPDATE tenant_subscriptions SET current_period_start=$1, print_cycle_anchor=$1, current_period_end=clock_timestamp()+interval '1 year' WHERE tenant_id=$2",
      [new Date("2026-10-15T10:30:00.000Z"), f.tenantId],
    );
    const observedAt = new Date((await pool().query("SELECT clock_timestamp() AS now")).rows[0].now);
    const expectedStart = new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth(), 1));
    const expectedEnd = new Date(Date.UTC(observedAt.getUTCFullYear(), observedAt.getUTCMonth() + 1, 1));
    const usage = await getTenantPrintUsage(db, f.tenantId);
    expect(usage.periodStart).toEqual(expectedStart);
    expect(usage.periodEnd).toEqual(expectedEnd);
  });

  it("preserves consumed credits during 0102 cutover without double-counting overlapping periods", async () => {
    const f = await seedFixture();
    const monthStart = new Date((await pool().query(
      "SELECT date_trunc('month', clock_timestamp() AT TIME ZONE 'UTC') AS month_start",
    )).rows[0].month_start);
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const rollingStart = new Date(monthStart.getTime() - 8 * 86_400_000);
    const rollingEnd = new Date(rollingStart.getTime() + 30 * 86_400_000);
    await pool().query(
      "INSERT INTO print_monthly_usage(tenant_id, period_start, period_end, used_prints) VALUES ($1,$2,$3,7),($1,$4,$5,3)",
      [f.tenantId, rollingStart, rollingEnd, monthStart, monthEnd],
    );
    const migrationSql = readFileSync("drizzle/0102_calendar_month_print_allowance.sql", "utf8");
    await pool().query(migrationSql);
    await pool().query(migrationSql);
    const usage = await getTenantPrintUsage(db, f.tenantId);
    expect(usage.used).toBe(7);
    expect(usage.periodStart).toEqual(monthStart);
    expect(usage.periodEnd).toEqual(monthEnd);
    const rows = await pool().query(
      "SELECT period_start, used_prints FROM print_monthly_usage WHERE tenant_id=$1 ORDER BY period_start",
      [f.tenantId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map(row => Number(row.used_prints))).toEqual([7, 7]);
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

  it("does not let expired queued jobs block a fresh admission after waiting for the tenant lock", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, "unlimited");
    // Saturate only the temporary Agent queue, not the subscription/rate
    // allowance. All 256 jobs expire AFTER the new transaction begins but
    // BEFORE it acquires the tenant's admission lock.
    await pool().query(
      `INSERT INTO print_jobs (id,tenant_id,agent_id,printer_id,status,payload,expires_at)
       SELECT 'stale-queue-' || n, $1, $2, $3, 'queued',
         '{"type":"raw","protocol":"raw","encoding":"base64","data":"cQ=="}'::jsonb,
         clock_timestamp() + interval '500 milliseconds'
       FROM generate_series(1, 256) AS n`,
      [f.tenantId, f.agentId, f.printerId],
    );
    const blocker = await pool().connect();
    let result: Promise<unknown> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`print_jobs:tenant:${f.tenantId}`]);
      result = createPrintJobForPrinter(f.printerId, payload("fresh-after-stale-queue"), {
        tenantId: f.tenantId, requestedBy: "quota-test",
        idempotencyKey: "fresh-after-stale-queue",
      }).then(value => ({ value }), error => ({ error }));
      await expect.poll(async () => Number((await pool().query(
        "SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = hashtext($1)::oid",
        [`print_jobs:tenant:${f.tenantId}`],
      )).rows[0].n)).toBe(1);
      await blocker.query("SELECT pg_sleep(0.8)");
      await blocker.query("COMMIT");
      const outcome = await result as { value?: { isReused: boolean }; error?: Error };
      expect(outcome.error).toBeUndefined();
      expect(outcome.value?.isReused).toBe(false);
      expect((await pool().query("SELECT count(*)::int AS n FROM print_jobs WHERE tenant_id=$1", [f.tenantId])).rows[0].n).toBe(257);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (result) await result;
    }
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

  it("does not grant duplicate monthly credits when the subscription term is renewed or extended", async () => {
    const f = await seedFixture();
    await setPlanLimit(f.tenantId, 2);
    await pool().query("UPDATE tenant_subscriptions SET current_period_start=statement_timestamp()-interval '1 day', print_cycle_anchor=statement_timestamp()-interval '1 day', current_period_end=statement_timestamp()+interval '1 month' WHERE tenant_id=$1", [f.tenantId]);
    await createPrintJobForPrinter(f.printerId, payload("term-1"), { tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination, idempotencyKey: "term-1" });
    const first = await getTenantPrintUsage(db, f.tenantId);
    await pool().query("UPDATE tenant_subscriptions SET current_period_start=clock_timestamp()-interval '1 hour', current_period_end=clock_timestamp()+interval '1 year', term='yearly' WHERE tenant_id=$1", [f.tenantId]);
    await createPrintJobForPrinter(f.printerId, payload("term-2"), { tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination, idempotencyKey: "term-2" });
    const renewed = await getTenantPrintUsage(db, f.tenantId);
    expect(renewed.periodStart).toEqual(first.periodStart);
    expect(renewed.periodEnd).toEqual(first.periodEnd);
    expect(renewed.used).toBe(2);
    expect(renewed.remaining).toBe(0);
    await expect(createPrintJobForPrinter(f.printerId, payload("term-3"), { tenantId: f.tenantId, requestedBy: "quota-test", documentType: "receipt", destination: f.destination, idempotencyKey: "term-3" })).rejects.toBeInstanceOf(TenantPrintQuotaExceededError);
    const rows = await pool().query("SELECT period_start, used_prints FROM print_monthly_usage WHERE tenant_id=$1", [f.tenantId]);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].used_prints).toBe(2);
  });
});
