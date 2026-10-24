import { expect } from "vitest";
import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../src/db";
import { auditEvents, billingEvents, tenantSubscriptions } from "../../src/db/schema";
import { pool, seedFixture } from "./pg";

/** Real persisted legacy evidence used to prove V4's retired routes are inert.
 * These are synthetic records; no provider or customer account is contacted. */
export async function seedRetiredBilling(status = "active") {
  const f = await seedFixture();
  const subscriptionId = `sub_${f.tenantId}`;
  const customerId = `cus_${f.tenantId}`;
  await db.update(tenantSubscriptions).set({ status, stripeSubscriptionId: subscriptionId,
    stripeCustomerId: customerId, monthlyQuota: 250, internalReference: "Retained legacy reference",
    stripeLastEventCreatedAt: new Date("2025-01-01T00:00:00Z"), stripeStateRevision: 7,
  }).where(eq(tenantSubscriptions.tenantId, f.tenantId));
  await db.insert(billingEvents).values({ eventId: `evt_old_${f.tenantId}`, eventType: "invoice.paid",
    tenantId: f.tenantId, payload: { retained: true }, processedAt: new Date("2025-01-01T00:00:00Z") });
  await db.insert(auditEvents).values({ id: `audit_old_${f.tenantId}`, tenantId: f.tenantId,
    actorType: "system", action: "billing.invoice.paid", metadata: { retained: true } });
  await pool().query(`INSERT INTO print_monthly_usage(tenant_id,period_start,period_end,used_prints)
    VALUES($1,date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC'),
      date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC') + interval '1 month',17)`, [f.tenantId]);
  return { ...f, subscriptionId, customerId, planId: `plan_${f.tenantId.slice("tenant_".length)}` };
}

export async function billingEvidenceSnapshot() {
  const snapshot: Record<string, unknown> = {};
  for (const table of ["tenants", "plans", "tenant_subscriptions", "billing_events", "audit_events",
    "print_monthly_usage", "subscription_changes", "subscription_requests"]) {
    snapshot[table] = (await pool().query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return snapshot;
}

export const testWebhookSecret = "whsec_synthetic_v4_retirement_only_not_a_provider_secret";
export function retiredWebhookRequest(payload: string, signature: "valid" | "invalid" | "missing" = "valid") {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", testWebhookSecret).update(`${timestamp}.${payload}`).digest("hex");
  return new Request("http://localhost/api/billing/webhook", { method: "POST",
    headers: { "content-type": "application/json", ...(signature === "missing" ? {} : {
      "stripe-signature": `t=${timestamp},v1=${signature === "valid" ? digest : "invalid"}`,
    }) }, body: payload });
}

export async function expectManualRetirement(response: Response) {
  expect(response.status).toBe(410);
  expect(await response.json()).toEqual({ error: "Manual subscription management required", code: "MANUAL_BILLING_REQUIRED" });
}
