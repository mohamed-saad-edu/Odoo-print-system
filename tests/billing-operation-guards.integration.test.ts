import type * as StripeModule from "../src/lib/stripe";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { tenants, users, tenantUsers, plans, tenantSubscriptions } from "../src/db/schema";
import { runBillingOperation } from "../src/lib/billing-operation";
import { applyMigrations, closePool, hasTestDatabase, truncateAll } from "./helpers/pg";
import { verifyWorkspaceToken, type ManagerClaims } from "../src/lib/manager-auth";
import { hashPassword } from "../src/lib/password";
import { TenantSuspendedError } from "../src/lib/tenant-guard";
import { createWorkspaceManagerTestSession } from "./helpers/workspace-session";
import { gatewayTestSigningKey } from "./helpers/test-secrets";

vi.mock("../src/lib/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof StripeModule>();
  return { ...actual, stripeRequest: vi.fn(async () => { throw new Error("Stripe must not be called for rejected states"); }) };
});

const suite = describe.skipIf(!hasTestDatabase);

const CANCEL = {
  type: "cancel" as const,
  missingSubscriptionError: "No active Stripe subscription",
  stripeParams: new URLSearchParams({ cancel_at_period_end: "true" }),
  cancelAtPeriodEnd: true,
  logLabel: "cancel",
};
const RESUME = {
  type: "resume" as const,
  missingSubscriptionError: "No Stripe subscription",
  stripeParams: new URLSearchParams({ cancel_at_period_end: "false" }),
  cancelAtPeriodEnd: false,
  logLabel: "resume",
};

suite("billing operation status matrix (D-7)", () => {
  let claims: ManagerClaims;
  let passwordHash: string;

  beforeAll(async () => {
    vi.stubEnv("GATEWAY_JWT_SECRET", gatewayTestSigningKey());
    passwordHash = await hashPassword("synthetic-billing-operation-fixture-password");
    await applyMigrations();
  });
  beforeEach(async () => {
    await truncateAll();
    vi.stubEnv("APP_BASE_URL", "https://billing.test");
    await db.insert(tenants).values({ id: "tenant_billop", name: "Billop Tenant" });
    await db.insert(users).values({ id: "user_billop", email: "billop@example.test", passwordHash, emailVerifiedAt: new Date() });
    await db.insert(tenantUsers).values({ userId: "user_billop", tenantId: "tenant_billop", role: "owner" });
    const session = await createWorkspaceManagerTestSession("tenant_billop", { userId: "user_billop", role: "owner" });
    const verified = await verifyWorkspaceToken(session.token);
    expect(verified).toMatchObject({ ver: 2, sid: session.refreshTokenId, familyId: session.familyId });
    if (!verified) throw new Error("Expected a verified workspace fixture session");
    claims = verified;
    await db.insert(plans).values({
      id: "plan_billop", name: "P", stripePriceId: "price_billop",
      entitlements: { max_agents: 1, max_printers: 1, max_jobs_per_minute: 10, max_concurrent_jobs: 1, max_prints_per_period: 10 },
      currency: "usd", interval: "month",
    });
  });
  afterAll(async () => { vi.unstubAllEnvs(); await closePool(); });

  async function seedStatus(status: string) {
    await db.insert(tenantSubscriptions).values({
      tenantId: "tenant_billop", planId: "plan_billop", status: status as never,
      stripeSubscriptionId: "sub_billop", stripeCustomerId: "cus_billop",
    });
  }

  it.each([
    ["cancelled", CANCEL], ["incomplete_expired", CANCEL], ["paused", CANCEL],
    ["cancelled", RESUME], ["incomplete_expired", RESUME], ["active", CANCEL],
  ] as const)("rejects retired %s workspace billing operations before Stripe", async (status, operation) => {
    await seedStatus(status);
    const { stripeRequest } = await import("../src/lib/stripe");
    vi.mocked(stripeRequest).mockClear();
    await expect(runBillingOperation(claims, operation)).rejects.toMatchObject({
      code: "WORKSPACE_AUTHORITY_CHANGED", status: 403,
    });
    expect(stripeRequest).not.toHaveBeenCalled();
    const row = await db.query.tenantSubscriptions.findFirst({
      where: eq(tenantSubscriptions.tenantId, "tenant_billop"),
    });
    expect(row?.billingOperationId).toBeNull();
    expect(row?.status).toBe(status);
  });

  it("rechecks tenant lifecycle before claiming an admitted billing mutation", async () => {
    await seedStatus("active");
    const { stripeRequest } = await import("../src/lib/stripe");
    vi.mocked(stripeRequest).mockClear();
    await db.update(tenants).set({ lifecycle: "suspended" }).where(eq(tenants.id, "tenant_billop"));
    await expect(runBillingOperation(claims, CANCEL)).rejects.toBeInstanceOf(TenantSuspendedError);
    expect(stripeRequest).not.toHaveBeenCalled();
    const row = await db.query.tenantSubscriptions.findFirst({ where: eq(tenantSubscriptions.tenantId, "tenant_billop") });
    expect(row?.billingOperationId).toBeNull();
  });
});
