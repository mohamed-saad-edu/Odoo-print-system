// V4 intentionally retires provider activation. V3 provider lifecycle behavior
// remains in the imported source history; these tests enforce the new boundary.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { tenantSubscriptions } from "../src/db/schema";
import { POST as webhook } from "../src/app/api/billing/webhook/route";
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

suite("V4 retired provider concurrency", () => {
  it("rejects 32 concurrent duplicates without provider calls, duplicate audit or usage changes", async () => {
    const f=await seedRetiredBilling("awaiting_activation"); const before=await billingEvidenceSnapshot();
    const payload=JSON.stringify({id:"evt_duplicate",type:"customer.subscription.updated",data:{object:{id:f.subscriptionId,status:"active",metadata:{tenant_id:f.tenantId}}}});
    const results=await Promise.all(Array.from({length:32},()=>webhook(retiredWebhookRequest(payload))));
    for(const result of results) await expectManualRetirement(result);
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
  it("cannot cross-bind either tenant when conflicting provider identities race", async () => {
    const first=await seedRetiredBilling(), second=await seedRetiredBilling("suspended"); const before=await billingEvidenceSnapshot();
    const results=await Promise.all(Array.from({length:20},(_,i)=>webhook(retiredWebhookRequest(JSON.stringify({id:`evt_${i}`,type:"checkout.session.completed",created:i%2?1000:2000,data:{object:{customer:first.customerId,subscription:second.subscriptionId,metadata:{tenant_id:i%2?first.tenantId:second.tenantId}}}})))));
    for(const result of results) await expectManualRetirement(result);
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
  it("does not undo an authorized manual state change while stale provider events arrive", async () => {
    const f=await seedRetiredBilling();
    const calls=Array.from({length:12},()=>webhook(retiredWebhookRequest(JSON.stringify({type:"customer.subscription.updated",data:{object:{id:f.subscriptionId,status:"active",metadata:{tenant_id:f.tenantId}}}}))));
    // A database state transition is used only as an isolation fixture here;
    // actual owner authorization/idempotency is tested in manual-subscriptions.integration.
    await db.update(tenantSubscriptions).set({status:"suspended",revision:1}).where(eq(tenantSubscriptions.tenantId,f.tenantId));
    const expected=await billingEvidenceSnapshot();
    for(const result of await Promise.all(calls)) await expectManualRetirement(result);
    expect(await billingEvidenceSnapshot()).toEqual(expected); await noProviderCalls();
  });
});
