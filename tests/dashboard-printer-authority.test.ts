import { verifiedPrinterState } from "./helpers/printer-verification";
// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement as h } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../src/i18n/react";
import { hasManagerPermission } from "../src/lib/authorization";
import type { ManagerClaims, ManagerRole } from "../src/lib/manager-auth";
import { getDashboardJobsResult, getDashboardStateResult } from "../src/app/actions";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../src/app/actions", () => ({
  deleteAgentResult: vi.fn(), getDashboardJobsResult: vi.fn(), getDashboardStateResult: vi.fn(),
  setAgentLifecycleResult: vi.fn(), setPrinterLifecycleResult: vi.fn(),
}));

import type { Agent, Printer } from "../src/app/dashboard/dashboard-client";

const seen = new Date();
const agent = {
  id: "owner", name: "Reception", pairingCode: null, status: "online", lifecycle: "active",
  lastSeenAt: seen, createdAt: seen, printerCount: 1,
} as const satisfies Agent;
const printer = {
  ...verifiedPrinterState("test-printer", seen),
  id: "physical", agentId: agent.id, name: "Canon", printerType: "physical",
  connectionType: "spooler", protocol: "spooler", lifecycle: "active", status: "online", lastSeenAt: seen,
  sharedWithGateway: true,
  managementSource: "agent", desiredRevision: 0, appliedDesiredRevision: 0, observedDesiredRevision: 0,
} as const satisfies Printer;
const fleet = { pageSize: 100, agentOffset: 0, agentHasMore: false, printerOffset: 0,
  printerHasMore: false, totalAgents: 1, onlineAgents: 1, totalPrinters: 1, onlinePrinters: 1, savedPrinters: 0 };

async function renderTree(role: ManagerRole, lifecycle = "active", diagnosticActorScope = `test-workspace:${role}`, printerOverrides: Partial<Printer> = {}, initialView: "home" | "printers" | "agents" = "printers") {
  const { default: DashboardClient } = await import("../src/app/dashboard/dashboard-client");
  const claims: ManagerClaims = { sub: "manager", tenantId: "test-workspace", role, jti: "audit", iat: 1, exp: 2 };
  return h(I18nProvider, { initialLocale: "en", children: h(DashboardClient, {
    initialAgents: [{ ...agent, lifecycle }], initialPrinters: [{ ...printer, ...printerOverrides }], initialJobs: [], databaseError: null,
    initialFleet: fleet, initialView,
    canReadBillingUsage: hasManagerPermission(claims, "billing.read"),
    canMutate: { printers: hasManagerPermission(claims, "printers.manage"), printersTest: hasManagerPermission(claims, "printers.test"),
      agentsPair: hasManagerPermission(claims, "agents.pair"), agentsLifecycle: hasManagerPermission(claims, "agents.disable") || hasManagerPermission(claims, "agents.retire"),
      jobsCancel: hasManagerPermission(claims, "jobs.cancel"), jobsRetry: hasManagerPermission(claims, "jobs.retry") },
    diagnosticActorScope,
  }) });
}
const render = async (role: ManagerRole, lifecycle = "active") => renderToStaticMarkup(await renderTree(role, lifecycle, `test-workspace:${role}`, {}, lifecycle === "disabled" ? "agents" : "printers"));

describe("dashboard printer action authority", () => {
  it("retains a by-ID local-only printer with its raw health while blocking cloud diagnostic controls", async () => {
    const html = renderToStaticMarkup(await renderTree("operator", "active", "test-workspace:operator", { sharedWithGateway: false }));
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toContain("Canon");
    expect(doc.body.textContent).toContain("Gateway sharing is turned off");
    // Keep physical health visible without exposing the retired Test Print action.
    expect([...doc.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Send test page")).toBe(false);
    expect(printer.status).toBe("online");
  });
  it("legacy viewer has operational printer details without Test Print controls", async () => {
    const html = await render("viewer");
    expect(html).toContain("Canon");
    expect(html).toContain("Technical details");
    expect(html).not.toContain(">Send test page<");
    expect(html).not.toContain(">Test page<");
  });

  it("does not expose a customer Test Print action to permitted operators", async () => {
    const html = await render("operator");
    expect(html).not.toContain(">Send test page<");
  });

  it.each(["viewer", "operator"] as const)("keeps Test Print retired in table view for %s", async (role) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes("/api/auth/me") ? { exp: Math.floor(Date.now() / 1000) + 3600 } : {
        plan: { id: "audit-plan", name: "Audit" }, resources: { agents: { used: 1, limit: 3 }, printers: { used: 1, limit: 3 },
          prints: { unit: "job", used: 0, limit: 100, remaining: 100, periodStart: seen.toISOString(), periodEnd: null } },
      }
    ), { status: 200 })));
    vi.mocked(getDashboardJobsResult).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(getDashboardStateResult).mockResolvedValue({ ok: true, data: {
      agents: [{ ...agent, pairingCodeExpiresAt: null, metadata: null, currentPrinterCount: 1, reportedStatus: agent.status, staleThresholdSeconds: 90 }],
      printers: [{ ...printer, agentName: agent.name, agentStatus: agent.status, agentLifecycle: agent.lifecycle, agentLastSeenAt: seen,
        agentStaleThresholdSeconds: 90, inventoryPresent: true, deviceClass: "unknown", config: null, capabilities: null }], jobs: [], fleet,
    } });
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      const tree = await renderTree(role);
      await act(async () => { root.render(tree); });
      const list = host.querySelector<HTMLButtonElement>('button[aria-label="List"]');
      expect(list).not.toBeNull();
      await act(async () => { list!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      expect(list!.getAttribute("aria-pressed")).toBe("true");
      const table = host.querySelector("table.data-table");
      expect(table).not.toBeNull();
      expect(table!.textContent).toContain("Canon");
      expect([...table!.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Test page")).toBe(false);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it.each(["viewer", "operator", "integration_admin", "billing_admin"] as const)(
    "legacy %s now has all Agent operational and lifecycle controls", async (role) => {
      const html = await render(role, "disabled");
      expect(html).toContain("Reception");
      expect(html).toContain("Register an agent");
      expect(html).toContain("Re-enable agent…");
      expect(html).toContain("Actions for agent Reception");
    });
  
  it.each(["owner", "admin"] as const)("retains Agent registration and re-enable for %s", async (role) => {
    const html = await render(role, "disabled");
    expect(html).toContain("Register an agent");
    expect(html).toContain("Re-enable agent…");
    expect(html).toContain("Actions for agent Reception");
  });

  it("uses matching lifecycle authority for every currently defined role and guards deletion", () => {
    for (const role of ["owner", "admin", "operator", "viewer", "integration_admin", "billing_admin"] as const) {
      const claims: ManagerClaims = { sub: "manager", tenantId: "test-workspace", role, jti: "audit", iat: 1, exp: 2 };
      expect(hasManagerPermission(claims, "agents.disable")).toBe(hasManagerPermission(claims, "agents.retire"));
    }
    const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
    const client = readFileSync("src/app/dashboard/dashboard-client.tsx", "utf8");
    expect(page).toContain('agentsPair: hasManagerPermission(claims, "agents.pair")');
    expect(client).toMatch(/canMutate\.agentsLifecycle \? \[\{\s*key: "delete"/);
  });

  it("guards remaining certification entry points with the server-projected permission", () => {
    const source = ts.createSourceFile("dashboard-client.tsx", readFileSync("src/app/dashboard/dashboard-client.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const entryPoints: ts.Node[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "Button" &&
          node.openingElement.attributes.properties.some((attribute) => {
            if (!ts.isJsxAttribute(attribute) || attribute.name.getText(source) !== "onClick") return false;
            let opensMutation = false;
            const calls = (child: ts.Node) => {
              if (ts.isCallExpression(child) && ts.isIdentifier(child.expression) &&
                  (child.expression.text === "handleGatewayTestPrint" || (child.expression.text === "setCertifyPrinter" && child.arguments[0]?.kind !== ts.SyntaxKind.NullKeyword))) opensMutation = true;
              ts.forEachChild(child, calls);
            };
            ts.forEachChild(attribute, calls);
            return opensMutation;
          })) {
        entryPoints.push(node);
      }
      if (ts.isObjectLiteralExpression(node) && node.properties.some((property) => ts.isPropertyAssignment(property) && property.name.getText(source) === "key" && property.initializer.getText(source) === '"certify"')) {
        entryPoints.push(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(source.getFullText()).not.toContain("handleGatewayTestPrint");
    // Customer Test Print was retired; two certification actions remain.
    expect(entryPoints).toHaveLength(2);
    for (const entry of entryPoints) {
      let ancestor: ts.Node | undefined = entry.parent;
      while (ancestor && !ts.isBinaryExpression(ancestor) && !ts.isConditionalExpression(ancestor)) ancestor = ancestor.parent;
      expect(ancestor && (ts.isBinaryExpression(ancestor) ? ancestor.left : (ancestor as ts.ConditionalExpression).condition).getText(source)).toBe("canMutate.printersTest");
    }
  });
});

const billingUsage = {
  plan: { id: "audit-plan", name: "Audit subscription" },
  resources: { agents: { used: 1, limit: 3 }, printers: { used: 1, limit: 3 },
    prints: { unit: "job", used: 7, limit: 100, remaining: 93, periodStart: seen.toISOString(), periodEnd: null } },
};
const usageResponse = () => new Response(JSON.stringify(billingUsage), { status: 200 });
const usageWarning = "Print usage is temporarily unavailable";

async function withMountedDashboard(
  role: ManagerRole,
  fetchUsage: (init: RequestInit | undefined) => Promise<Response>,
  inspect: (host: HTMLDivElement, fetchMock: ReturnType<typeof vi.fn>, rerender: (role: ManagerRole, scope?: string) => Promise<void>) => Promise<void>,
  hasSubscription = true,
) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/billing/status") {
      return Response.json({ hasSubscription }, { status: 200 });
    }
    if (String(input) === "/api/billing/usage") return fetchUsage(init);
    if (String(input) === "/api/auth/me") return new Response(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }), { status: 200 });
    throw new Error(`Unexpected dashboard fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.mocked(getDashboardJobsResult).mockResolvedValue({ ok: true, data: [] });
  vi.mocked(getDashboardStateResult).mockResolvedValue({ ok: true, data: {
    agents: [{ ...agent, pairingCodeExpiresAt: null, metadata: null, currentPrinterCount: 1, reportedStatus: agent.status, staleThresholdSeconds: 90 }],
    printers: [{ ...printer, agentName: agent.name, agentStatus: agent.status, agentLifecycle: agent.lifecycle, agentLastSeenAt: seen,
      agentStaleThresholdSeconds: 90, inventoryPresent: true, deviceClass: "unknown", config: null, capabilities: null }], jobs: [], fleet,
  } });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const rerender = async (nextRole: ManagerRole, scope = `test-workspace:${nextRole}`) => {
    const tree = await renderTree(nextRole, "active", scope, {}, "home");
    await act(async () => { root.render(tree); });
  };
  try {
    await rerender(role);
    await inspect(host, fetchMock, rerender);
  } finally {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  }
}

const usageRequests = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.filter(([input]) => input === "/api/billing/usage");
async function refreshDashboard(host: HTMLDivElement) {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Refresh console data"]');
  expect(button).not.toBeNull();
  await act(async () => { button!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("workspace dashboard billing usage follows the owner-only read permission", () => {
  it.each(["admin","operator","viewer","integration_admin","billing_admin"] as const)(
    "does not poll quota or reveal commercial plan to %s", async role => {
      await withMountedDashboard(role, async () => usageResponse(), async (host, fetchMock) => {
        await refreshDashboard(host);
        expect(usageRequests(fetchMock)).toHaveLength(0);
        expect(host.textContent).not.toContain("Audit subscription");
        expect(host.textContent).not.toContain("Jobs remaining this month");
        expect(host.textContent).not.toContain(usageWarning);
      });
    });
  it("owner can inspect their own usage without Platform Admin navigation", async () => {
    await withMountedDashboard("owner", async () => usageResponse(), async (host, fetchMock) => {
      await refreshDashboard(host);
      expect(usageRequests(fetchMock).length).toBeGreaterThan(0);
      expect(router.replace).not.toHaveBeenCalledWith("/platform/subscriptions");
    });
  });
  it("changing between non-owner sessions never enables billing reads", async () => {
    await withMountedDashboard("admin", async () => usageResponse(), async (host, fetchMock, rerender) => {
      await rerender("viewer", "another-workspace:another-user:viewer");
      await refreshDashboard(host);
      expect(usageRequests(fetchMock)).toHaveLength(0);
      expect(host.textContent).not.toContain("Audit subscription");
    });
  });
  it("projects the owner-only billing.read guard on the server", () => {
    const page = readFileSync("src/app/dashboard/page.tsx", "utf8");
    expect(page).toContain('canReadBillingUsage={hasManagerPermission(claims, "billing.read")}');
    const route = readFileSync("src/app/api/billing/usage/route.ts", "utf8");
    expect(route).toContain('requireManagerPermission(manager, "billing.read")');
  });
});
