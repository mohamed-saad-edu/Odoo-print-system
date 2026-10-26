// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import InvitePage from "../src/app/invite/page";
import OnboardingPage from "../src/app/onboarding/page";
import { I18nProvider } from "../src/i18n/react";
import { translate } from "../src/i18n/translate";
import { fetchWithTimeout } from "../src/lib/fetch-timeout";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("../src/lib/fetch-timeout", () => ({ fetchWithTimeout: vi.fn() }));
vi.mock("../src/lib/session-config", () => ({ ensureCustomerSession: vi.fn(async () => ({ authenticated: true, expiresAt: Date.now() + 3600000 })) }));
vi.mock("../src/components/AuthShell", () => ({ AuthShell: ({ children }: { children: ReactNode }) => h("main", null, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation, useSearchParams: () => new URLSearchParams("token=synthetic-invitation") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as ReactNode) }));

let root: Root;
let host: HTMLDivElement;
const fetchMock = vi.mocked(fetchWithTimeout);
const response = (status: number, value: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => value }) as Response;
const plans = [
  { id: "plan-one", name: "Starter", currency: "USD", interval: "month", entitlements: { max_prints_per_period: 100 } },
  { id: "plan-two", name: "Team", currency: "USD", interval: "year", entitlements: { max_prints_per_period: 1000 } },
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

 });

describe("manual onboarding recovery", () => {
  function onboardingFixture(status: "awaiting_activation" | "active" | "expired" | "suspended", pending = false) {
    const state = { status, pending };
    fetchMock.mockImplementation(async (url, init) => {
      if (url === "/api/onboarding" && init?.method !== "POST") return response(200, {
        tenant: { id: "tenant-ui", name: "Synthetic café" }, role: "owner", plans, subscription: { planId: "plan-one" },
      });
      if (url === "/api/subscription-requests" && init?.method !== "POST") return response(200, {
        status: state.status, requests: state.pending ? [{ id: "req_one", reference: "req_one", status: "pending", createdAt: "2026-01-01T10:00:00Z", planId: "plan-one", term: "monthly" }] : [],
      });
      return response(200, { ok: true });
    });
    return state;
  }

  it.each(["en", "ar"] as const)("shows the activated checklist without starting another subscription (%s)", async locale => {
    onboardingFixture("active");
    await render(h(OnboardingPage), locale);
    expect(host.textContent).toContain(translate(locale, "v4.onboarding.ready"));
    // Active entitlement is not evidence that a Windows computer or printer is ready.
    expect(host.textContent).not.toContain(locale === "en" ? "Your workspace is ready" : "مساحة عملك جاهزة");
    const checklist = host.querySelector("details");
    expect(checklist).not.toBeNull();
    expect(checklist?.open).toBe(false);
    expect(checklist?.querySelectorAll("li")).toHaveLength(4);
    expect(host.querySelector('a[href="/dashboard"]')).not.toBeNull();
    expect(host.querySelector('a[href="/api-keys"]')).not.toBeNull();
    expect(host.querySelector('form')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps a recorded request pending until the authoritative status changes", async () => {
    const state = onboardingFixture("awaiting_activation", true);
    await render(h(OnboardingPage));
    expect(host.textContent).toContain("Your activation request is recorded");
    expect(host.textContent).toContain("req_one");
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('a[href="/dashboard"]')).toBeNull();
    state.status = "active";
    await act(async () => button("Check activation status").click());
    expect(host.textContent).toContain(translate("en", "v4.onboarding.ready"));
    expect(host.querySelector('a[href="/dashboard"]')).not.toBeNull();
    expect(host.querySelector('form')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("reconciles a recorded request with a lost response through an explicit status refresh", async () => {
    const state = onboardingFixture("awaiting_activation");
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      if (args[0] === "/api/subscription-requests" && args[1]?.method === "POST") {
        state.pending = true;
        throw new Error("synthetic transport failure with private diagnostic");
      }
      return normalFetch(...args);
    });
    await render(h(OnboardingPage));
    await act(async () => button("Request activation").click());
    expect(host.textContent).toContain("We could not confirm your activation request");
    expect(host.textContent).not.toContain("private diagnostic");
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(async () => button("Try again").click());
    expect(host.textContent).toContain("Your activation request is recorded");
    expect(host.querySelector('a[href="/dashboard"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/subscription-requests" && init?.method === "POST")).toHaveLength(1);
  });

  it("uses native plan and term radios and submits no trial or checkout fields", async () => {
    const state = onboardingFixture("awaiting_activation");
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      if (args[0] === "/api/subscription-requests" && args[1]?.method === "POST") state.pending = true;
      return normalFetch(...args);
    });
    await render(h(OnboardingPage));
    const radios = host.querySelectorAll<HTMLInputElement>('input[type="radio"][name="plan"]');
    expect(radios).toHaveLength(2);
    expect(radios[0].checked).toBe(true);
    await act(async () => radios[1].click());
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
    await act(async () => host.querySelectorAll<HTMLInputElement>('input[name="term"]')[1].click());
    await act(async () => button("Request activation").click());
    const setup = fetchMock.mock.calls.find(([url, init]) => url === "/api/onboarding" && init?.method === "POST")!;
    expect(JSON.parse(String(setup[1]?.body))).toEqual({ workspaceName: "Synthetic café", planId: "plan-two" });
    const request = fetchMock.mock.calls.find(([url, init]) => url === "/api/subscription-requests" && init?.method === "POST")!;
    expect(JSON.parse(String(request[1]?.body))).toEqual({ planId: "plan-two", term: "yearly" });
    expect(new Headers(request[1]?.headers).get("Idempotency-Key")).toMatch(/^[a-f0-9-]{36}$/);
    expect(navigation.replace).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/billing/checkout"))).toBe(false);
  });

  it("reuses the request identity after an ambiguous submission retry", async () => {
    onboardingFixture("awaiting_activation");
    const normalFetch = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (...args) => {
      if (args[0] === "/api/subscription-requests" && args[1]?.method === "POST") return response(503, { code: "TEMPORARILY_UNAVAILABLE" });
      return normalFetch(...args);
    });
    await render(h(OnboardingPage));
    await act(async () => button("Request activation").click());
    await act(async () => button("Request activation").click());
    const requests = fetchMock.mock.calls.filter(([url, init]) => url === "/api/subscription-requests" && init?.method === "POST");
    expect(requests).toHaveLength(2);
    expect(new Headers(requests[0][1]?.headers).get("Idempotency-Key")).toBe(new Headers(requests[1][1]?.headers).get("Idempotency-Key"));
    expect(host.querySelector('a[href="/dashboard"]')).toBeNull();
  });
});
