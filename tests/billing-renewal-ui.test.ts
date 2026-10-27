import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("workspace subscription page", () => {
  const billing = readFileSync("src/app/billing/page.tsx", "utf8");
  it("uses the authenticated workspace instead of Platform Admin", () => {
    expect(billing).toContain("verifyWorkspaceTokenFromCookieValues(");
    expect(billing).toContain("customerSubscriptionState(");
    expect(billing).toContain('redirect("/login?next=%2Fbilling")');
    expect(billing).not.toContain('redirect("/platform/subscriptions")');
  });
  it("preserves the requested plan and displays manual request controls", () => {
    expect(billing).toContain("selectedPlanId");
    expect(billing).toContain("<BillingActions");
    expect(billing).toContain("publishedPlanPrice");
    expect(billing).toContain('t("v4.subscription.catalogPrice")');
    expect(billing).toContain("initialRequest=");
    expect(billing).toContain("currentPeriodEnd");
  });
});
