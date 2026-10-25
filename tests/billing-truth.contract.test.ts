import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { v4OnboardingAr, v4OnboardingEn } from "../src/i18n/messages/v4-onboarding";

// Billing truthfulness (C055/C064): only persisted manual subscription state
// grants access. The stored plan remains history when access is inactive;
// contract terms and calendar-month quotas render honestly in both languages.
describe("billing confirmation evidence and localization", () => {
  it("never turns checkout query parameters into activation evidence", () => {
    const page = readFileSync("src/app/billing/page.tsx", "utf8");
    const actions = readFileSync("src/components/BillingActions.tsx", "utf8");
    expect(page).toContain("searchParams: Promise<{ plan?: string | string[] }>");
    expect(page).toContain("const status = customerSubscriptionState(sub, tenant?.lifecycle, now)");
    expect(page).not.toMatch(/checkoutState|hasStripeSubscription|params\.(checkout|success)/);
    expect(actions).toContain('fetchWithTimeout("/api/subscription-requests"');
    expect(actions).not.toMatch(/\/api\/billing\/(checkout|portal|cancel|resume)|setStatus\("active"\)/);
  });

  it("scopes the displayed current plan to a live subscription", () => {
    const page = readFileSync("src/app/billing/page.tsx", "utf8");
    const pricing = readFileSync("src/app/pricing/page.tsx", "utf8");
    const home = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain('status === "active" ? "v4.subscription.currentContract" : "v4.subscription.recordedContract"');
    expect(page).toContain('status !== "active" &&');
    expect(page).toContain('t("v4.subscription.balanceNotAccess")');
    expect(pricing).toContain('customerSubscriptionState(sub,tenant?.lifecycle,now) === "active"');
    expect(pricing).toContain("currentPlanId = sub!.planId");
    for (const source of [page, pricing]) {
      expect(source).toContain("customerSubscriptionState(sub,");
      expect(source).toContain("databaseNowMs()");
      expect(source).toMatch(/lifecycle:\s*true/);
    }
    // Home must use the same effective-state policy, with all of its inputs;
    // a stored active status alone must never imply live commercial access.
    expect(home).toContain('const hasPlan = !!planName && subscriptionStatus === "active"');
    expect(home).toContain("customerSubscriptionState(subscription, tenant?.lifecycle, await databaseNowMs())");
    expect(home).toContain("currentPeriodStart: true, currentPeriodEnd: true, entitlementBlocked: true");
    expect(home).toMatch(/lifecycle:\s*true/);
    expect(home).not.toContain('subscription.status === "past_due" ||');
    for (const state of ["active", "pending", "expired", "suspended"]) {
      expect(home).toContain(`"v4.onboarding.${state}"`);
    }
    expect(home).toContain('const canBilling = hasManagerPermission(claims, "billing.read")');
    expect(home).toContain("const plan = canBilling && subscription");
    expect(home).toContain("periodEnd={canBilling ? subscription?.currentPeriodEnd ?? null : null}");
  });

  it("translates intervals instead of rendering raw enums", () => {
    const labels = readFileSync("src/lib/billing-labels.ts", "utf8");
    const en = readFileSync("src/i18n/messages/en.ts", "utf8");
    const ar = readFileSync("src/i18n/messages/ar.ts", "utf8");
    expect(labels).toContain("platform.plans.interval");
    for (const key of ["platform.plans.interval.month", "platform.plans.interval.year"]) {
      expect(en).toContain(`"${key}":`);
      expect(ar).toContain(`"${key}":`);
    }
    const billing = readFileSync("src/app/billing/page.tsx", "utf8");
    for (const key of ["v4.onboarding.monthly", "v4.onboarding.yearly", "v4.subscription.custom", "v4.subscription.notSet"] as const) {
      expect(billing).toContain(`"${key}"`);
      expect(v4OnboardingEn[key]).toBeTruthy();
      expect(v4OnboardingAr[key]).toMatch(/\p{Script=Arabic}/u);
    }
    expect(billing).toContain('t(sub?.term === "yearly"');
    expect(billing).not.toContain("currentPlan?.interval ?? ");
    expect(billing).not.toMatch(/>\s*\{sub\??\.term\}\s*</);
    expect(readFileSync("src/components/platform/SubscriptionEditor.tsx", "utf8")).toContain("a(v)");
    expect(readFileSync("src/i18n/messages/v4-admin.ts", "utf8")).toContain("v4.admin.yearly");
  });

  it("describes quotas as finite instead of promising no surprise stops", () => {
    const en = readFileSync("src/i18n/messages/en.ts", "utf8");
    expect(en).toContain("pricing.point1");
    expect(en).not.toContain("you never hit a surprise stop");
  });
});
