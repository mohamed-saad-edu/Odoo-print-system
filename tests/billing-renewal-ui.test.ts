// @vitest-environment jsdom
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BillingPage from "../src/app/billing/page";
import { I18nProvider } from "../src/i18n/react";
import { translate } from "../src/i18n/translate";

const fixture = vi.hoisted(() => ({ locale: "en" as "en" | "ar", subscription: {} as Record<string, unknown> }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => ({ value: name === "yaseir_locale" ? fixture.locale : "synthetic-session" }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), redirect: (path: string) => { throw new Error(`Unexpected redirect: ${path}`); } }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as ReactNode) }));
vi.mock("../src/lib/manager-auth", () => ({ getManagerCookieName: () => "manager_session", verifyWorkspaceTokenFromCookieValues: async () => ({ role: "owner", tenantId: "synthetic-tenant" }) }));
vi.mock("../src/lib/database-clock", () => ({ refreshClockSkew: async () => {} }));
vi.mock("../src/lib/entitlements", () => ({
  getTenantPrintUsage: async () => null,
  isBillingAccessStatus: (status: string) => ["trialing", "active", "past_due"].includes(status),
  isSubscriptionPeriodLive: () => true,
}));
vi.mock("../src/db", () => ({ db: {
  query: {
    tenantSubscriptions: { findFirst: async () => fixture.subscription },
    plans: { findFirst: async () => ({ id: "plan-one", name: "Synthetic plan", description: null, currency: "USD", interval: "month", entitlements: {} }) },
  },
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => [] }) }) }),
} }));

beforeEach(() => {
  localStorage.clear();
  fixture.subscription = {
    tenantId: "synthetic-tenant", planId: "plan-one", status: "trialing",
    currentPeriodEnd: new Date("2030-06-30T12:00:00Z"), cancelAtPeriodEnd: false,
    stripeCustomerId: null, stripeSubscriptionId: null, checkoutStatus: "none", entitlementBlocked: false,
  };
});

describe("billing renewal evidence", () => {
  for (const locale of ["en", "ar"] as const) {
    it.each([
      { status: "trialing", linked: false, cancel: false, renewal: "period" },
      { status: "active", linked: false, cancel: false, renewal: "period" },
      { status: "paused", linked: true, cancel: false, renewal: "period" },
      { status: "unpaid", linked: true, cancel: false, renewal: "period" },
      { status: "active", linked: true, cancel: false, renewal: "renew" },
      { status: "active", linked: true, cancel: true, renewal: "cancel" },
    ])(`renders the actual renewal commitment in ${locale}: $status / linked=$linked / cancel=$cancel`, async ({ status, linked, cancel, renewal }) => {
      fixture.locale = locale;
      document.cookie = `yaseir_locale=${locale}; path=/`;
      Object.assign(fixture.subscription, { status, cancelAtPeriodEnd: cancel, stripeCustomerId: linked ? "synthetic-customer" : null, stripeSubscriptionId: linked ? "synthetic-subscription" : null });
      const element = await BillingPage({ searchParams: Promise.resolve({}) });
      const doc = new DOMParser().parseFromString(renderToStaticMarkup(h(I18nProvider, { initialLocale: locale, children: element })), "text/html");
      const label = [...doc.querySelectorAll(".label-caps")].find(node => node.textContent === translate(locale, "billing.renewal"));
      const expectedKey = renewal === "renew" ? "billing.renewsOn" : renewal === "cancel" ? "billing.cancelScheduled" : "billing.periodEndsOn";
      const expectedPrefix = translate(locale, expectedKey, { date: "SYNTHETIC_DATE" }).split("SYNTHETIC_DATE")[0];
      expect(label?.parentElement?.textContent).toContain(expectedPrefix);
      if (renewal === "period") {
        const renewalPrefix = translate(locale, "billing.renewsOn", { date: "SYNTHETIC_DATE" }).split("SYNTHETIC_DATE")[0];
        expect(doc.body.textContent).not.toContain(renewalPrefix);
      }
    });
  }
});
