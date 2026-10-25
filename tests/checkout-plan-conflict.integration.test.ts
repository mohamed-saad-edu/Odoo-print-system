// V4 intentionally retires provider activation. V3 provider lifecycle behavior
// remains in the imported source history; these tests enforce the new boundary.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { tenantSubscriptions } from "../src/db/schema";
import { POST as checkout } from "../src/app/api/billing/checkout/route";
import { applyMigrations, closePool, hasTestDatabase, truncateAll } from "./helpers/pg";
import { seedRetiredBilling, billingEvidenceSnapshot, retiredWebhookRequest, expectManualRetirement, testWebhookSecret } from "./helpers/manual-billing-retirement";
vi.mock(import("../src/lib/stripe"), async (original) => ({ ...(await original()), stripeRequest: vi.fn(), stripeRetrieve: vi.fn(), stripeList: vi.fn() }));
const suite = describe.skipIf(!hasTestDatabase);
beforeAll(async () => { vi.stubEnv("STRIPE_WEBHOOK_SECRET", testWebhookSecret); await applyMigrations(); });
beforeEach(async () => { await truncateAll(); vi.clearAllMocks(); });
afterAll(async () => { vi.unstubAllEnvs(); await closePool(); });
async function noProviderCalls() {
  const provider = await import("../src/lib/stripe");
  expect(provider.stripeRequest).not.toHaveBeenCalled(); expect(provider.stripeRetrieve).not.toHaveBeenCalled(); expect(provider.stripeList).not.toHaveBeenCalled();
}

suite("V4 retired checkout preserves historical intent evidence", () => {
  it.each(["none","creating","open","completed"])("does not replay, clear or replace a legacy %s checkout", async checkoutStatus => {
    const f=await seedRetiredBilling("cancelled");
    await db.update(tenantSubscriptions).set({checkoutStatus,checkoutPlanId:f.planId,checkoutIdempotencyKey:`legacy_${f.tenantId}`,checkoutSessionId:`cs_${f.tenantId}`,checkoutSessionUrl:"https://checkout.example.invalid/legacy-private-url",checkoutIntentCreatedAt:new Date("2025-01-01T00:00:00Z"),checkoutSessionExpiresAt:new Date("2025-01-02T00:00:00Z")}).where(eq(tenantSubscriptions.tenantId,f.tenantId));
    const before=await billingEvidenceSnapshot();
    for(const planId of [f.planId,"different_plan"]){
      await expectManualRetirement(await checkout(new Request("http://localhost/api/billing/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planId})})));
    }
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
  it("rejects concurrent plan requests without creating a payable external session", async()=>{
    await seedRetiredBilling("awaiting_activation"); const before=await billingEvidenceSnapshot();
    const results=await Promise.all(Array.from({length:20},(_,i)=>checkout(new Request("http://localhost/api/billing/checkout",{method:"POST",body:JSON.stringify({planId:`plan_${i%2}`})}))));
    for(const result of results)await expectManualRetirement(result);
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
});
