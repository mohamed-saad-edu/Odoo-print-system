// V4 intentionally retires provider activation. V3 provider lifecycle behavior
// remains in the imported source history; these tests enforce the new boundary.
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

suite("V4 provider events cannot revive incomplete subscriptions", () => {
  it.each(["checkout.session.completed","customer.subscription.created"])("rejects %s while preserving the incomplete legacy identity",async type=>{
    const f=await seedRetiredBilling("incomplete_expired");const before=await billingEvidenceSnapshot();
    await expectManualRetirement(await webhook(retiredWebhookRequest(JSON.stringify({id:"evt_replacement",type,data:{object:{id:"sub_new",customer:f.customerId,status:"active",subscription:"sub_new",metadata:{tenant_id:f.tenantId}}}}))));
    expect(await billingEvidenceSnapshot()).toEqual(before);await noProviderCalls();
  });
});
