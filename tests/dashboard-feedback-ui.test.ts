// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardClient, { type Agent, type Printer } from "../src/app/dashboard/dashboard-client";
import { getDashboardJobsResult, getDashboardStateResult, setAgentLifecycleResult } from "../src/app/actions";
import { fetchWithTimeout } from "../src/lib/fetch-timeout";
import { I18nProvider } from "../src/i18n/react";
import { WorkspaceSecurityNotice } from "../src/components/WorkspaceSecurity";

vi.mock("../src/app/actions", () => ({
  deleteAgentResult: vi.fn(), getDashboardJobsResult: vi.fn(), getDashboardStateResult: vi.fn(),
  setAgentLifecycleResult: vi.fn(), setPrinterLifecycleResult: vi.fn(),
}));
vi.mock("../src/lib/fetch-timeout", () => ({ fetchWithTimeout: vi.fn(), WORKSPACE_REAUTHENTICATION_EVENT: "yaseir:workspace-reauthentication-required" }));
vi.mock("../src/lib/session-config", () => ({ ensureCustomerSession: async () => ({ authenticated: true }) }));
const router = vi.hoisted(() => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => {
  // Next Link consumes prefetch; it is not a native anchor attribute.
  delete props.prefetch;
  return h("a", props, children as React.ReactNode);
} }));

const fleet = { pageSize: 100, agentOffset: 0, agentHasMore: false, printerOffset: 0, printerHasMore: false, totalAgents: 0, onlineAgents: 0, totalPrinters: 0, onlinePrinters: 0, savedPrinters: 0 };
const props = {
  initialAgents: [] as Agent[], initialPrinters: [] as Printer[], initialJobs: [], initialFleet: fleet,
  databaseError: null, canReadBillingUsage: false, diagnosticActorScope: "synthetic:owner",
  canMutate: { printers: true, printersTest: false, agentsPair: true, agentsLifecycle: true, jobsCancel: true, jobsRetry: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  localStorage.clear();
  document.cookie = "yaseir_locale=en; path=/";
  vi.mocked(getDashboardJobsResult).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(getDashboardStateResult).mockResolvedValue({ ok: true, data: { agents: [], printers: [], jobs: [], fleet } });
  vi.mocked(fetchWithTimeout).mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("workspace dashboard evidence and feedback", () => {
  it.each([
    [403, "WORKSPACE_REAUTHENTICATION_REQUIRED", true, false],
    [401, "SESSION_EXPIRED", false, true],
    [403, "FORBIDDEN", false, false],
    [503, "WORKSPACE_REAUTHENTICATION_REQUIRED", false, false],
  ] as const)("routes server-action %s/%s to the correct workspace feedback without retry", async (status, code, needsConfirmation, expired) => {
    const now = new Date();
    const agent: Agent = { id: "blocked-action-agent", name: "Synthetic disabled agent", lifecycle: "disabled", status: "offline",
      lastSeenAt: now, createdAt: now, pairingCode: null, printerCount: 0 };
    vi.mocked(getDashboardStateResult).mockResolvedValue({ ok: true, data: { agents: [agent], printers: [], jobs: [], fleet } } as never);
    const mutation = vi.mocked(setAgentLifecycleResult).mockResolvedValue({ ok: false, error: "server-policy-detail", status, code });
    const host = document.createElement("div"); document.body.appendChild(host); const root = createRoot(host);
    try {
      await act(async () => root.render(h(I18nProvider, { initialLocale: "en", children:
        h("div", null, h(WorkspaceSecurityNotice), h(DashboardClient, { ...props, initialView: "agents", initialAgents: [agent] })) })));
      const button = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === "Re-enable agent…");
      expect(button).toBeDefined();
      await act(async () => button!.click());
      expect(mutation).toHaveBeenCalledExactlyOnceWith(agent.id, "active");
      const notice = host.querySelector('[data-testid="workspace-reauthentication-notice"]');
      expect(Boolean(notice)).toBe(needsConfirmation);
      if (needsConfirmation) {
        expect(notice?.querySelector("a")?.getAttribute("href")).toMatch(/^\/settings\?reauth=1/);
        expect(host.textContent).toContain("Confirm your identity before making a sensitive workspace change.");
        expect(host.textContent).not.toContain("server-policy-detail");
      }
      const redirect = expired
        ? "/login?next=%2Fdashboard"
        : status === 403 && code === "FORBIDDEN" ? "/" : null;
      if (redirect) expect(router.replace).toHaveBeenCalledExactlyOnceWith(redirect);
      else expect(router.replace).not.toHaveBeenCalled();
      expect(host.textContent).not.toContain("server-policy-detail");
      await act(async () => window.dispatchEvent(new Event("yaseir:workspace-reauthenticated")));
      expect(mutation).toHaveBeenCalledTimes(1);
    } finally { await act(async () => root.unmount()); host.remove(); }
  });

  it.each(["en", "ar"] as const)("keeps initial focus, Tab containment and Escape return in registration (%s)", async locale => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      localStorage.setItem("yaseir:locale", locale);
      document.cookie = `yaseir_locale=${locale}; path=/`;
      await act(async () => root.render(h(I18nProvider, { initialLocale: locale, children: h(DashboardClient, { ...props, initialView: "agents" }) })));
      const trigger = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.trim() === (locale === "en" ? "Register an agent" : "تسجيل وكيل"))!;
      await act(async () => { trigger.focus(); trigger.click(); });
      const dialog = document.querySelector('[role="dialog"]')!;
      expect(document.activeElement).toBe(dialog);
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })));
      expect(document.activeElement).toBe(dialog.querySelector("button"));
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })));
      expect(dialog.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.textContent).toBe(locale === "en" ? "Cancel" : "إلغاء");
      await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      // A non-owner gets one non-commercial subscription status probe; no protected billing data is fetched.
      expect(vi.mocked(fetchWithTimeout).mock.calls.map(call => call[0])).toEqual(["/api/billing/status"]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it("qualifies the healthy agent count without claiming all operations are normal", () => {
    const html = renderToStaticMarkup(h(DashboardClient, { ...props, initialFleet: { ...fleet, totalAgents: 1, onlineAgents: 1, totalPrinters: 1, onlinePrinters: 0 } }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toContain("All agents reachable");
    expect(doc.body.textContent).not.toContain("All normal");
  });

  it("shows registration failure inside its open dialog and permits a successful retry", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const fetchMock = vi.mocked(fetchWithTimeout);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ code: "AGENT_CREATE_FAILED", error: "synthetic-private-diagnostic" }), { status: 503 }));
    try {
      await act(async () => { root.render(h(DashboardClient, { ...props, initialView: "agents" })); });
      const open = [...host.querySelectorAll("button")].find((node) => node.textContent?.trim() === "Register an agent")!;
      await act(async () => open.click());
      const dialog = document.querySelector('[role="dialog"]')!;
      const input = dialog.querySelector<HTMLInputElement>("#agent-name")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Synthetic front desk");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const submit = () => [...dialog.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === "Generate pairing code")!;
      await act(async () => submit().click());
      expect(dialog.querySelector('[role="alert"]')).not.toBeNull();
      expect(dialog.textContent).not.toContain("synthetic-private-diagnostic");
      expect(submit().disabled).toBe(false);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "synthetic-agent", pairingCode: "SYNTH1", expiresAt: new Date(Date.now() + 600000).toISOString() }), { status: 200 }));
      await act(async () => submit().click());
      expect(dialog.querySelector('[role="alert"]')).toBeNull();
      expect(dialog.textContent).toContain("SYNTH1");
      expect(fetchMock.mock.calls.filter(([url, init]) => url === "/api/agents" && init?.method === "POST")).toHaveLength(2);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
