// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvitePage from "../src/app/invite/page";
import OnboardingPage from "../src/app/onboarding/page";
import { BillingActions } from "../src/components/BillingActions";
import { I18nProvider } from "../src/i18n/react";
import { fetchWithTimeout } from "../src/lib/fetch-timeout";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("../src/lib/fetch-timeout", () => ({ fetchWithTimeout: vi.fn() }));
vi.mock("../src/components/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => h("main", null, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => new URLSearchParams("token=synthetic-invitation") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as ReactNode) }));

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.mocked(fetchWithTimeout);
const response = (status: number, value: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => value }) as Response;
const plans = [
  { id: "plan-one", name: "Starter", currency: "USD", interval: "month", entitlements: { max_agents: 1 } },
  { id: "plan-two", name: "Team", currency: "USD", interval: "year", entitlements: { max_agents: 3 } },
];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  vi.stubGlobal("matchMedia", (media: string) => ({ matches: false, media, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  fetchMock.mockReset();
  Object.values(navigation).forEach((fn) => fn.mockReset());
  localStorage.clear();
  document.cookie = "yaseir_locale=en; path=/";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function render(node: ReactNode, locale: "en" | "ar" = "en") {
  localStorage.setItem("yaseir:locale", locale);
  document.cookie = `yaseir_locale=${locale}; path=/`;
  await act(async () => { root.render(h(I18nProvider, { initialLocale: locale, children: node })); });
}

function button(label: string, within: ParentNode = document) {
  const result = [...within.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);
  expect(result, `Missing button ${label}`).toBeDefined();
  return result!;
}

describe("customer recovery feedback", () => {
  it.each(["en", "ar"] as const)("does not claim an invitation was accepted when sign-in is still required (%s)", async (locale) => {
    fetchMock.mockImplementation(async (_url, init) => init?.method === "POST"
      ? response(403, { code: "SIGN_IN_REQUIRED" })
      : response(200, { email: "invitee@example.invalid", workspaceName: "Synthetic café", role: "viewer" }));
    await render(h(InvitePage), locale);
    await act(async () => button(locale === "en" ? "Accept invitation" : "قبول الدعوة").click());
    const feedback = host.querySelector('[role="status"]')!;
    expect(feedback.textContent).not.toContain(locale === "en" ? "Invitation accepted" : "تم قبول الدعوة");
    expect(feedback.textContent).toContain(locale === "en" ? "Sign in" : "تسجيل الدخول");
    expect(feedback.querySelector("a")?.getAttribute("href")).toBe("/login?next=%2Finvite%3Ftoken%3Dsynthetic-invitation&switch=1");
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it.each(["en", "ar"] as const)("keeps cancellation failure and retry inside the active billing dialog (%s)", async (locale) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(response(503, { error: "synthetic-provider-diagnostic" }));
    await render(h(BillingActions, { hasSubscription: true, cancelAtPeriodEnd: false, subscriptionStatus: "active", canOpenPortal: true }), locale);
    const action = locale === "en" ? "Cancel at period end" : "إلغاء بنهاية الدورة";
    await act(async () => button(action).click());
    let dialog = document.querySelector('[role="dialog"]')!;
    await act(async () => button(action, dialog).click());
    dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog).not.toBeNull();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(locale === "en" ? "Billing request failed" : "تعذّر تنفيذ طلب الفوترة");
    expect(dialog.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(dialog.textContent).not.toContain("synthetic-provider-diagnostic");
    expect(navigation.refresh).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(response(200, { ok: true }));
    await act(async () => button(action, dialog).click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/billing/cancel", "/api/billing/cancel"]);
  });
});

describe("onboarding recovery", () => {
  function onboardingFixture(status: string | null) {
    const state = { status };
    fetchMock.mockImplementation(async (url, init) => {
      if (url === "/api/billing/plans") return response(200, { plans });
      if (url === "/api/onboarding" && init?.method !== "POST") return response(200, {
        tenant: { name: "Synthetic café" }, subscription: state.status ? { planId: "plan-one", status: state.status } : null,
      });
      return response(200, { ok: true });
    });
    return state;
  }

  it.each(["trialing", "active", "past_due"])("offers continuation instead of another trial for a %s workspace", async (status) => {
    onboardingFixture(status);
    await render(h(OnboardingPage));
    expect(host.textContent).toContain("Workspace already set up");
    expect([...host.querySelectorAll("button")].some((node) => node.textContent === "Start free trial")).toBe(false);
    expect(host.querySelector('a[href="/dashboard"]')).not.toBeNull();
    expect(host.querySelector('a[href="/billing"]')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("reconciles an accepted trial with a lost response into a usable continuation state", async () => {
    const state = onboardingFixture(null);
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      if (args[0] === "/api/onboarding" && args[1]?.method === "POST") {
        state.status = "trialing";
        return response(409, { code: "TRIAL_NOT_AVAILABLE" });
      }
      return normalFetch(...args);
    });
    await render(h(OnboardingPage));
    await act(async () => button("Start free trial").click());
    expect(host.querySelector('a[href="/dashboard"]')).not.toBeNull();
    expect(host.textContent).toContain("Workspace already set up");
    expect(host.textContent).not.toContain("Setup failed");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("uses native radio selection and preserves a fresh trial's selected immutable plan", async () => {
    onboardingFixture(null);
    await render(h(OnboardingPage));
    const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="onboarding-plan"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    await act(async () => radios[1].click());
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
    await act(async () => button("Start free trial").click());
    const [, init] = fetchMock.mock.calls.find(([url, request]) => url === "/api/onboarding" && request?.method === "POST")!;
    expect(JSON.parse(String(init?.body))).toEqual({ workspaceName: "Synthetic café", planId: "plan-two", trial: true });
    expect(navigation.replace).toHaveBeenCalledWith("/dashboard");
  });
});
