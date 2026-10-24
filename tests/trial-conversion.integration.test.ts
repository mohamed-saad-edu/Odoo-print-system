// V4 intentionally retires provider activation. V3 provider lifecycle behavior
// remains in the imported source history; these tests enforce the new boundary.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { POST as webhook } from "../src/app/api/billing/webhook/route";
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

import { getTenantPrintUsage, TenantSubscriptionRequiredError } from "../src/lib/entitlements";
suite("V4 legacy trials never become self-activated paid workspaces",()=>{
  it.each(["trialing","past_due"])("rejects checkout and signed conversion for legacy %s status",async status=>{
    const f=await seedRetiredBilling(status);const before=await billingEvidenceSnapshot();
    await expectManualRetirement(await checkout(new Request("http://localhost/api/billing/checkout",{method:"POST",body:JSON.stringify({planId:f.planId})})));
    await expectManualRetirement(await webhook(retiredWebhookRequest(JSON.stringify({id:"evt_convert",type:"customer.subscription.updated",data:{object:{id:f.subscriptionId,status:"active",metadata:{tenant_id:f.tenantId}}}}))));
    expect(await billingEvidenceSnapshot()).toEqual(before);
    await expect(getTenantPrintUsage(db,f.tenantId)).rejects.toBeInstanceOf(TenantSubscriptionRequiredError);
    await noProviderCalls();
  });
});
