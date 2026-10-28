import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import {
  hasTestDatabase,
  applyMigrations,
  truncateAll,
  seedFixture,
  insertQueuedJob,
  pool,
  closePool,
  type Fixture,
} from "./helpers/pg";
import { users, tenants, tenantSubscriptions, subscriptionRequests } from "../src/db/schema";
import { db } from "../src/db";
import { eq } from "drizzle-orm";
import { nanoid } from "../src/lib/nanoid";
import { createVerifiedPlatformSession as createPlatformSession } from "./helpers/platform-session";
import { GET } from "../src/app/api/platform/stats/route";
import { GET as platformFleetGET } from "../src/app/api/platform/fleet/route";
import { GET as subscriptionListGET } from "../src/app/api/platform/subscriptions/route";
import { GET as tenantListGET } from "../src/app/api/platform/tenants/route";
import { GET as tenantDetailGET } from "../src/app/api/platform/tenants/[id]/route";
import { GET as subscriptionRequestsGET } from "../src/app/api/platform/subscription-requests/route";
import { getTenantEntitlementLimit, TenantSubscriptionRequiredError, TenantEntitlementConfigError } from "../src/lib/entitlements";

const suite = describe.skipIf(!hasTestDatabase);

let prevSecret: string | undefined;
let fixture: Fixture;
let platformToken = "";
let platformUserId = "";

suite("Platform Stats Route", () => {
  beforeAll(async () => {
    prevSecret = process.env.GATEWAY_JWT_SECRET;
    process.env.GATEWAY_JWT_SECRET = "x".repeat(40);
    await applyMigrations();
  });

  beforeEach(async () => {
    await truncateAll();
    fixture = await seedFixture();

    const userId = `usr_${nanoid(18)}`;
    platformUserId = userId;
    const email = `platform_${nanoid(8)}@platform.local`;
    await db.insert(users).values({
      id: userId,
      email,
      passwordHash: "unused-in-route-test",
      isPlatformOwner: true,
      emailVerifiedAt: new Date(),
    });
    const session = await createPlatformSession(userId, email);
    platformToken = session.token;
  });

  afterAll(async () => {
    if (prevSecret !== undefined) process.env.GATEWAY_JWT_SECRET = prevSecret;
    else delete process.env.GATEWAY_JWT_SECRET;
    await closePool();
  });

  it.each([
    { status: "active", active: 1, awaitingActivation: 0, expired: 0, suspended: 0, attention: 0 },
    { status: "awaiting_activation", active: 0, awaitingActivation: 1, expired: 0, suspended: 0, attention: 1 },
    { status: "expired", active: 0, awaitingActivation: 0, expired: 1, suspended: 0, attention: 1 },
    { status: "suspended", active: 0, awaitingActivation: 0, expired: 0, suspended: 1, attention: 0 },
  ])("aggregates the manual-only $status subscription lifecycle", async ({ status, ...expected }) => {
    await db.update(tenantSubscriptions)
      .set({ status })
      .where(eq(tenantSubscriptions.tenantId, fixture.tenantId));

    await insertQueuedJob(fixture, `job_${nanoid(10)}`);

    const response = await GET(new Request("http://localhost/api/platform/stats", {
      headers: { Authorization: `Bearer ${platformToken}`, "cache-control": "no-cache" },
    }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.subscriptions).toMatchObject({ total: 1, ...expected });
    expect(Object.keys(body.subscriptions).sort()).toEqual([
      "active", "attention", "awaitingActivation", "expired", "suspended", "total",
    ]);
    expect(body.jobs24h.total).toBe(1);
    expect(body.jobs24hHourly).toHaveLength(25);
    expect(body.jobs24hHourly.some((row: { total: number; queued: number }) => row.total === 1 && row.queued === 1)).toBe(true);
  });


  it("counts a receipt even when another tenant has a live job with the same ID", async () => {
    const other = await seedFixture();
    const id = `cross-tenant-stats-${nanoid(10)}`;
    // Both tables have their own primary key: the identical opaque ID is
    // permitted in separate tenants and must not suppress either operation.
    await pool().query(`
      INSERT INTO print_job_receipts
        (id, tenant_id, fingerprint, printer_id, agent_id,
         destination, document_type, status, output_medium, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'receipt', 'receipt', 'success',
              'physical', clock_timestamp(), clock_timestamp())
    `, [id, fixture.tenantId, "a".repeat(64), fixture.printerId, fixture.agentId]);
    await insertQueuedJob(other, id);
    const response = await GET(new Request("http://localhost/api/platform/stats", {
      headers: { Authorization: `Bearer ${platformToken}`, "cache-control": "no-cache" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs24h).toMatchObject({ total: 2, success: 1, queued: 1 });
    expect(body.jobs24hHourly.reduce((sum: number, hour: { total: number }) => sum + hour.total, 0)).toBe(2);
  });

  it("does not double-count a live job and receipt of the same tenant and ID", async () => {
    const id = `same-tenant-stats-${nanoid(10)}`;
    await pool().query(`
      INSERT INTO print_job_receipts
        (id, tenant_id, fingerprint, printer_id, agent_id,
         destination, document_type, status, output_medium, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 'receipt', 'receipt', 'success',
              'physical', clock_timestamp(), clock_timestamp())
    `, [id, fixture.tenantId, "b".repeat(64), fixture.printerId, fixture.agentId]);
    await insertQueuedJob(fixture, id);
    const response = await GET(new Request("http://localhost/api/platform/stats", {
      headers: { Authorization: `Bearer ${platformToken}`, "cache-control": "no-cache" },
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.jobs24h).toMatchObject({ total: 1, queued: 1, success: 0 });
  });

  it("rejects malformed platform fleet pagination instead of silently coercing it", async () => {
    for (const field of ["limit", "offset"]) {
      for (const invalid of ["", "1e1", "1.0", " 1", "+2"]) {
        const url = new URL("http://localhost/api/platform/fleet?kind=agents");
        url.searchParams.set(field, invalid);
        const response = await platformFleetGET(new Request(url, {
          headers: { Authorization: `Bearer ${platformToken}` },
        }));
        expect(response.status, `${field}=${JSON.stringify(invalid)}`).toBe(400);
        expect(await response.json()).toMatchObject({ code: "INVALID_PAGINATION" });
      }
    }
    const valid = await platformFleetGET(new Request("http://localhost/api/platform/fleet?kind=agents&limit=2&offset=0", {
      headers: { Authorization: `Bearer ${platformToken}` },
    }));
    expect(valid.status).toBe(200);
    expect(await valid.json()).toMatchObject({ kind: "agents", limit: 2, offset: 0 });
  });

  it("pages subscriptions without silently dropping matches after the first page", async () => {
    const second = await seedFixture();
    await db.update(tenantSubscriptions).set({ status: "suspended" }).where(eq(tenantSubscriptions.tenantId, second.tenantId));
    const fetchList = async (query: string) => {
      const r = await subscriptionListGET(new Request("http://localhost/api/platform/subscriptions?" + query,
        { headers: { Authorization: "Bearer " + platformToken } }));
      return { status: r.status, data: await r.json(), cache: r.headers.get("Cache-Control") };
    };
    const first = await fetchList("limit=1&offset=0");
    const next = await fetchList("limit=1&offset=1");
    expect(first).toMatchObject({ status: 200, cache: "private, no-store", data: { limit: 1, offset: 0, hasMore: true } });
    expect(next).toMatchObject({ status: 200, data: { limit: 1, offset: 1, hasMore: false } });
    expect(new Set([first.data.subscriptions[0].tenantId, next.data.subscriptions[0].tenantId]).size).toBe(2);
    const filtered = await fetchList("status=suspended&limit=1");
    expect(filtered.data).toMatchObject({ hasMore: false, subscriptions: [{ tenantId: second.tenantId, status: "suspended" }] });
    const searched = await fetchList("status=suspended&search=" + encodeURIComponent(second.tenantId));
    expect(searched.data.subscriptions).toHaveLength(1);
    for (const invalid of ["offset=1e2", "limit=1.0", "status=bogus"]) {
      expect((await fetchList(invalid)).status, invalid).toBe(400);
    }
  });
  it("keeps platform list, dashboard and runtime admission consistent for expired and blocked contracts", async () => {
    const [subscription] = await db.select({ planId: tenantSubscriptions.planId })
      .from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, fixture.tenantId));
    await db.insert(subscriptionRequests).values({
      id: `req_${nanoid(16)}`, tenantId: fixture.tenantId,
      requesterUserId: platformUserId, requesterName: "Test Customer",
      requesterEmail: "customer@example.test", requesterVerifiedAt: new Date(),
      planId: subscription.planId, term: "monthly",
      idempotencyKey: `request_${nanoid(24)}`, requestDigest: "test-request",
    });
    const headers = { Authorization: `Bearer ${platformToken}`, "cache-control": "no-cache" };
    async function verify(status: "expired" | "suspended") {
      const [statsResponse, listResponse, tenantsResponse, requestsResponse] = await Promise.all([
        GET(new Request("http://localhost/api/platform/stats", { headers })),
        subscriptionListGET(new Request("http://localhost/api/platform/subscriptions", { headers })),
        tenantListGET(new Request("http://localhost/api/platform/tenants", { headers })),
        subscriptionRequestsGET(new Request("http://localhost/api/platform/subscription-requests", { headers })),
      ]);
      expect(statsResponse.status).toBe(200);
      expect(listResponse.status).toBe(200);
      expect(tenantsResponse.status).toBe(200);
      expect(requestsResponse.status).toBe(200);
      const stats = await statsResponse.json();
      expect(stats.subscriptions).toMatchObject({
        active: 0, expired: status === "expired" ? 1 : 0,
        suspended: status === "suspended" ? 1 : 0,
        attention: status === "expired" ? 1 : 0,
      });
      expect(stats.business.active).toBe(0);
      expect((await listResponse.json()).subscriptions.find((row: { tenantId: string }) => row.tenantId === fixture.tenantId)?.status).toBe(status);
      expect((await tenantsResponse.json()).tenants.find((row: { id: string }) => row.id === fixture.tenantId)?.subscriptionStatus).toBe(status);
      expect((await requestsResponse.json()).requests.find((row: { tenant_id: string }) => row.tenant_id === fixture.tenantId)?.currentSubscriptionStatus).toBe(status);
    }

    // An active flag with no finite end is not an admissible contract.
    await db.update(tenantSubscriptions).set({ status: "active", currentPeriodEnd: null, entitlementBlocked: false })
      .where(eq(tenantSubscriptions.tenantId, fixture.tenantId));
    await expect(getTenantEntitlementLimit(db, fixture.tenantId, "max_printers")).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
    await verify("expired");

    // A finite contract that the operator explicitly blocked is also not active.
    await db.update(tenantSubscriptions).set({
      currentPeriodEnd: new Date(Date.now() + 86_400_000), entitlementBlocked: true,
    }).where(eq(tenantSubscriptions.tenantId, fixture.tenantId));
    await expect(getTenantEntitlementLimit(db, fixture.tenantId, "max_printers")).rejects.toBeInstanceOf(TenantEntitlementConfigError);
    await verify("suspended");
  });

  it("only offers contract reactivation when the authoritative database deadline is live", async () => {
    const id = fixture.tenantId;
    const context = { params: Promise.resolve({ id }) };
    const req = () => new Request(`http://localhost/api/platform/tenants/${id}`, {
      headers: { Authorization: `Bearer ${platformToken}` },
    });
    await db.update(tenantSubscriptions).set({
      status: "suspended", currentPeriodEnd: new Date(Date.now() + 86_400_000),
    }).where(eq(tenantSubscriptions.tenantId, id));
    const live = await tenantDetailGET(req(), context);
    expect(live.status).toBe(200);
    expect((await live.json()).subscription.canReactivate).toBe(true);
    for (const lifecycle of ["suspended", "deleted"] as const) {
      await db.update(tenants).set({ lifecycle }).where(eq(tenants.id, id));
      const blocked = await tenantDetailGET(req(), context);
      expect(blocked.status).toBe(200);
      expect((await blocked.json()).subscription).toMatchObject({effectiveStatus:"suspended",canReactivate:false});
    }
    await db.update(tenants).set({ lifecycle: "active" }).where(eq(tenants.id, id));
    await db.update(tenantSubscriptions).set({currentPeriodStart:new Date(Date.now()+60_000)})
      .where(eq(tenantSubscriptions.tenantId,id));
    const future = await tenantDetailGET(req(),context);
    expect(future.status).toBe(200);
    expect((await future.json()).subscription.canReactivate).toBe(false);
    await db.update(tenantSubscriptions).set({currentPeriodStart:new Date(Date.now()-60_000)})
      .where(eq(tenantSubscriptions.tenantId,id));
    const restored = await tenantDetailGET(req(),context);
    expect((await restored.json()).subscription.canReactivate).toBe(true);

    await db.update(tenantSubscriptions).set({ currentPeriodEnd: new Date(Date.now() - 86_400_000) })
      .where(eq(tenantSubscriptions.tenantId, id));
    const expired = await tenantDetailGET(req(), context);
    expect(expired.status).toBe(200);
    expect((await expired.json()).subscription.canReactivate).toBe(false);

    await db.update(tenantSubscriptions).set({ currentPeriodEnd: null })
      .where(eq(tenantSubscriptions.tenantId, id));
    const missing = await tenantDetailGET(req(), context);
    expect(missing.status).toBe(200);
    expect((await missing.json()).subscription.canReactivate).toBe(false);
  });
});
