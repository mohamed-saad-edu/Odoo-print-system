// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SubscriptionEditor, type ManualSubscription } from "../src/components/platform/SubscriptionEditor";
import { I18nProvider } from "../src/i18n/react";
import { LOCALE_COOKIE_KEY, LOCALE_STORAGE_KEY, type Locale } from "../src/i18n/config";
import { translate, type MessageKey } from "../src/i18n/translate";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = undefined;
  host.remove();
});

function renderEditor(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.cookie = `${LOCALE_COOKIE_KEY}=${locale}; path=/`;
  const subscription: ManualSubscription = {
    planId: "annual", planName: "Annual plan", status: "active", effectiveStatus: "active",
    subscriptionType: "paid", monthlyQuota: 100, term: "yearly",
    currentPeriodStart: "2026-01-31T00:00:00.000Z",
    currentPeriodEnd: "2028-01-31T00:00:00.000Z", cancelAtPeriodEnd: false,
    internalReference: null, revision: 2, monthlyUsed: 14, nextReset: "2026-11-01T00:00:00.000Z",
  };
  root = createRoot(host);
  act(() => root!.render(h(I18nProvider, {
    initialLocale: locale,
    children: h(SubscriptionEditor, {
      tenantId: "renewal-workspace", subscription,
      plans: [{ id: "annual", name: "Annual plan", description: "", entitlements: { max_prints_per_period: 100 }, isActive: true, isPublic: true, displayOrder: 0 }],
      onSaved: () => undefined,
    }),
  })));
  return (key: string) => {
    const text = translate(locale, `v4.admin.${key}` as MessageKey);
    const label = [...host.querySelectorAll("label")].find(node => node.querySelector("span")?.textContent === text);
    const control = label?.querySelector("select,input") as HTMLSelectElement | HTMLInputElement | null;
    expect(control, `Missing localized ${key} control`).not.toBeNull();
    return control!;
  };
}

function choose(control: HTMLSelectElement | HTMLInputElement, value: string) {
  act(() => {
    control.value = value;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("subscription renewal dates", () => {
  it.each(["en", "ar"] as const)("extends from the existing expiry when the renewal term changes in %s", locale => {
    const field = renderEditor(locale);
    choose(field("action"), "renew");
    expect(field("start").value).toBe("2026-01-31");
    expect(field("start").disabled).toBe(true);
    expect(field("end").value).toBe("2029-01-31");

    choose(field("term"), "monthly");
    // A renewal buys time after the current contract, including leap years.
    expect(field("end").value).toBe("2028-02-29");
    choose(field("term"), "yearly");
    expect(field("end").value).toBe("2029-01-31");
    expect(field("start").value).toBe("2026-01-31");
  });

  it.each(["en", "ar"] as const)("keeps the selected renewal expiry when choosing a custom term in %s", locale => {
    const field = renderEditor(locale);
    choose(field("action"), "renew");
    choose(field("term"), "custom");
    expect(field("end").value).toBe("2029-01-31");
  });
});
