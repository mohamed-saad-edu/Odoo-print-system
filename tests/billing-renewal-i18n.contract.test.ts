import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { v4OnboardingAr, v4OnboardingEn } from "../src/i18n/messages/v4-onboarding";

describe("billing renewal localization contract", () => {
  it("never hardcodes English renewal copy into the localized billing page", () => {
    const source = readFileSync("src/app/billing/page.tsx", "utf8");

    expect(source).not.toContain("`Renews ${formatDate(");
    expect(source).not.toContain("`Ends ${formatDate(");
    expect(source).not.toContain("`Ended ${formatDate(");

    expect(source).not.toContain('t("billing.renewsOn"');
    expect(source).toContain("currentPeriodEnd");
    expect(source).toContain("BillingActions");
    expect(source).not.toContain('redirect("/platform/subscriptions")');
    const platform = readFileSync("src/components/platform/SubscriptionEditor.tsx", "utf8");
    expect(platform).toContain("a(v)");
    const calendarDates = readFileSync("src/lib/manual-calendar-date.ts", "utf8");
    expect(calendarDates).toContain("intlLocale(locale)");
    expect(calendarDates).toMatch(/timeZone:\s*['"]UTC['"]/);
    for (const key of ["v4.subscription.endsAtTerm", "v4.subscription.manualRenewal"] as const) {
      expect(v4OnboardingEn[key]).toMatch(/Platform Owner/);
      expect(v4OnboardingAr[key]).toMatch(/\p{Script=Arabic}/u);
    }
    expect(v4OnboardingEn["v4.subscription.manualRenewal"]).toMatch(/no automatic charge or automatic renewal/i);
    for (const key of ["v4.subscription.quotaBlockedTitle", "v4.subscription.quotaBlockedBody", "v4.subscription.quotaBlockedAction", "v4.subscription.expiringSoonTitle", "v4.subscription.expiringSoonBody", "v4.subscription.renewalDoesNotReset", "v4.subscription.legacyEndMissingTitle", "v4.subscription.legacyEndMissingBody"] as const) {
      expect(v4OnboardingEn[key]).toBeTruthy();
      expect(v4OnboardingAr[key]).toMatch(/\p{Script=Arabic}/u);
    }
  });
});
