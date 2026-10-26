import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { v4OnboardingAr, v4OnboardingEn } from "../src/i18n/messages/v4-onboarding";
const read = (path: string) => readFileSync(path, "utf8");

describe("subscription is never controlled or personalized through workspace roles", () => {
  it("workspace billing and onboarding pages redirect without reading or mutating subscription data", () => {
    for (const page of ["src/app/billing/page.tsx", "src/app/onboarding/page.tsx"]) {
      const source = read(page);
      expect(source).toContain('redirect("/dashboard")');
      expect(source).not.toContain("/api/subscription-requests");
      expect(source).not.toContain("billing/checkout");
      expect(source).not.toContain("customerSubscriptionState");
    }
    expect(read("src/app/api/subscription-requests/route.ts")).toContain("PLATFORM_OWNER_REQUIRED");
  });
  it("public pricing never queries or displays the logged-in workspace contract", () => {
    const pricing = read("src/app/pricing/page.tsx");
    expect(pricing).not.toContain("tenantSubscriptions.findFirst");
    expect(pricing).not.toContain("currentPlanId");
    expect(pricing).not.toContain("/billing?plan=");
    const home = read("src/app/page.tsx");
    expect(home).toContain('const canBilling = hasManagerPermission(claims, "billing.read")');
    expect(home).toContain("const plan = canBilling && subscription");
    expect(home).toContain('customerSubscriptionState(subscription, tenant?.lifecycle, await databaseNowMs())');
    expect(home).not.toContain('subscription.status === "past_due" ||');
  });
  it("reserves commercial plan changes for a separately authenticated Platform Owner", () => {
    const platform = read("src/app/api/platform/subscriptions/route.ts");
    expect(platform).toContain("requirePlatformOwner");
    const editor = read("src/components/platform/SubscriptionEditor.tsx");
    expect(editor).toContain("a(v)");
    const usage = read("src/app/api/billing/usage/route.ts");
    expect(usage).toContain('requireManagerPermission(manager, "billing.read")');
  });
  it("keeps terms and billing interval localization available exclusively to Platform Admin", () => {
    const labels = read("src/lib/billing-labels.ts");
    const en = read("src/i18n/messages/en.ts");
    const ar = read("src/i18n/messages/ar.ts");
    expect(labels).toContain("platform.plans.interval");
    for (const key of ["platform.plans.interval.month", "platform.plans.interval.year"]) {
      expect(en).toContain(`"${key}":`);
      expect(ar).toContain(`"${key}":`);
    }
    for (const key of ["v4.onboarding.monthly", "v4.onboarding.yearly", "v4.subscription.custom", "v4.subscription.notSet"] as const) {
      expect(v4OnboardingEn[key]).toBeTruthy();
      expect(v4OnboardingAr[key]).toMatch(/\p{Script=Arabic}/u);
    }
    expect(read("src/i18n/messages/v4-admin.ts")).toContain("v4.admin.yearly");
  });
  it("does not promise unlimited use while the subscription has finite quotas", () => {
    const en = read("src/i18n/messages/en.ts");
    expect(en).toContain("pricing.point1");
    expect(en).not.toContain("you never hit a surprise stop");
  });
});
