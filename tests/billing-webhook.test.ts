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

suite("V4 retired billing webhook", () => {
  it.each(["checkout.session.completed", "checkout.session.expired", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "customer.subscription.paused", "customer.subscription.resumed", "customer.subscription.trial_will_end", "invoice.paid", "invoice.payment_failed"])("rejects signed %s without changing persisted subscription, usage or history", async type => {
    const f = await seedRetiredBilling("awaiting_activation");
    const before = await billingEvidenceSnapshot();
    const payload = JSON.stringify({ id: "evt_new", type, created: Math.floor(Date.now()/1000), data: { object: { id: f.subscriptionId, customer: f.customerId, status: "active", subscription: f.subscriptionId, client_reference_id: f.tenantId, metadata: { tenant_id: f.tenantId }, current_period_end: 2147483647 } } });
    await expectManualRetirement(await webhook(retiredWebhookRequest(payload)));
    expect(await billingEvidenceSnapshot()).toEqual(before);
    await noProviderCalls();
  });
  it.each(["valid", "invalid", "missing"] as const)("cannot mutate an active manual subscription with a %s provider signature", async signature => {
    const f = await seedRetiredBilling();
    const before = await billingEvidenceSnapshot();
    await expectManualRetirement(await webhook(retiredWebhookRequest(JSON.stringify({type:"customer.subscription.deleted",data:{object:{id:f.subscriptionId,metadata:{tenant_id:f.tenantId}}}}),signature)));
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
  it.each(["{invalid", "null", "{}"])("rejects malformed or incomplete payload without recording false processed evidence: %s", async payload => {
    await seedRetiredBilling(); const before = await billingEvidenceSnapshot();
    await expectManualRetirement(await webhook(retiredWebhookRequest(payload)));
    expect(await billingEvidenceSnapshot()).toEqual(before); await noProviderCalls();
  });
});
