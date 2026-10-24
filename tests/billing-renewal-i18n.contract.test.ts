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
    expect(source).toContain('t(sub?.cancelAtPeriodEnd ? "v4.subscription.endsAtTerm" : "v4.subscription.manualRenewal")');
    expect(source).toContain('t("v4.subscription.end"), date(sub?.currentPeriodEnd)');
    expect(source).toContain("formatManualCalendarDate(value, locale)");
    const calendarDates = readFileSync("src/lib/manual-calendar-date.ts", "utf8");
    expect(calendarDates).toContain("intlLocale(locale)");
    expect(calendarDates).toMatch(/timeZone:\s*['"]UTC['"]/);
    for (const key of ["v4.subscription.endsAtTerm", "v4.subscription.manualRenewal"] as const) {
      expect(v4OnboardingEn[key]).toMatch(/Platform Owner/);
      expect(v4OnboardingAr[key]).toMatch(/\p{Script=Arabic}/u);
    }
    expect(v4OnboardingEn["v4.subscription.manualRenewal"]).toMatch(/no automatic charge or automatic renewal/i);
  });
});
