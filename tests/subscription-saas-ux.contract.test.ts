import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { v4AdminEn, v4AdminAr } from "../src/i18n/messages/v4-admin";
import { v4OnboardingEn, v4OnboardingAr } from "../src/i18n/messages/v4-onboarding";
const read = (path: string) => readFileSync(path, "utf8");

describe("customer and Platform Admin subscription UX boundaries", () => {
  it("keeps approved requests as history rather than permanent success banners", () => {
    const actions = read("src/components/BillingActions.tsx");
    expect(actions).toContain("showRequestForm");
    expect(actions).toContain("request && <details");
    expect(actions).toContain('t("v4.subscription.lastRequest")');
    expect(actions).not.toContain('tone={request.status === "approved"');
    expect(actions).toContain('fetchWithTimeout("/api/subscription-requests"');
    expect(actions).toContain("idempotency.current");
  });
  it("only exposes real supported plan features in cards", () => {
    const pricing = read("src/app/pricing/page.tsx");
    expect(pricing).toContain('["v4.pricing.featureOdoo"');
    expect(pricing).toContain('v4.pricing.featureActivity');
    expect(pricing).toContain('<bdi dir="ltr">');
    expect(pricing).not.toContain('t("v4.pricing.intro")');
    for (const key of ["featureOdoo","featurePos","featureBranches","featureActivity"] as const) {
      expect(v4OnboardingAr["v4.pricing." + key as keyof typeof v4OnboardingAr]).toMatch(/\p{Script=Arabic}/u);
      expect(v4OnboardingEn["v4.pricing." + key as keyof typeof v4OnboardingEn]).toBeTruthy();
    }
  });
  it("keeps usage ratios legible in RTL and offers safe manual termination without DELETE", () => {
    const listing = read("src/app/platform/subscriptions/page.tsx");
    const detail = read("src/app/platform/tenants/[id]/page.tsx");
    const editor = read("src/components/platform/SubscriptionEditor.tsx");
    const backend = read("src/app/api/platform/tenants/[id]/subscription/route.ts");
    const mutation = read("src/lib/manual-subscriptions.ts");
    expect(listing).toContain('bdi dir="ltr"');
    expect(listing).toContain("subscriptionAction=revoke");
    expect(listing).toContain('item.status === "active"');
    expect(listing).not.toContain('method: "DELETE"');
    expect(detail).toContain('searchParams.get("subscriptionAction")');
    expect(detail).toContain('const linkedRequest=!directAction && pending');
    expect(editor).toContain('preferredAction === "revoke"');
    expect(editor).toContain('a("endSubscriptionWarning")');
    expect(editor).toContain('"/api/platform/auth/reauth"');
    expect(backend).toContain("requirePlatformOwner(req)");
    expect(backend).toContain("requireIdempotencyKey(req)");
    expect(mutation).toContain("input.action==='suspend'||input.action==='revoke'");
    expect(mutation).toContain("subscriptionChanges");
    for (const key of ["endSubscriptionNow","endSubscriptionWarning","usedOfQuota"] as const) {
      expect(v4AdminEn["v4.admin." + key as keyof typeof v4AdminEn]).toBeTruthy();
      expect(v4AdminAr["v4.admin." + key as keyof typeof v4AdminAr]).toMatch(/\p{Script=Arabic}/u);
    }
  });
});
