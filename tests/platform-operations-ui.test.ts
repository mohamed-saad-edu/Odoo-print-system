// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { I18nProvider } from "../src/i18n/react";
import { fetchWithTimeout } from "../src/lib/fetch-timeout";
import PlatformDashboardPage from "../src/app/platform/dashboard/page";
import PlatformPrintOperationsPage from "../src/app/platform/jobs/page";
import PlatformDatabasePage from "../src/app/platform/database/page";
import PlatformFleetPage from "../src/app/platform/fleet/page";
import PlatformIntegrationsPage from "../src/app/platform/integrations/page";
import { PlatformSidebar } from "../src/components/platform/PlatformSidebar";

vi.mock("../src/lib/fetch-timeout", () => ({ fetchWithTimeout: vi.fn() }));
vi.mock("next/navigation", () => {
  const router = { replace: vi.fn(), push: vi.fn() };
  return { useRouter: () => router, usePathname: () => "/platform/dashboard" };
});
vi.mock("next/link", () => ({ default: ({ children, ...props }: Record<string, unknown>) => h("a", props, children as ReactNode) }));

let root: Root | undefined;
let host: HTMLDivElement;
const fetchMock = vi.mocked(fetchWithTimeout);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  fetchMock.mockReset();
  localStorage.clear();
  document.cookie = "yaseir_locale=en; path=/";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

async function render(node: ReactNode, locale: "en" | "ar" = "en") {
  localStorage.setItem("yaseir:locale", locale);
  document.cookie = `yaseir_locale=${locale}; path=/`;
  await act(async () => { root?.render(h(I18nProvider, { initialLocale: locale, children: node })); });
}

function button(label: string) {
  const node = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent?.trim() === label || item.getAttribute("aria-label") === label,
  );
  expect(node, `Expected a button named ${label}`).toBeDefined();
  return node!;
}

async function click(node: HTMLElement) {
  await act(async () => { node.click(); });
}

async function enter(node: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const tables = [{ name: "printers", columns: ["id", "name", "status"], primaryKey: "id" }];
const catalog = { tables, selected: null, columns: [], rows: [], hasMore: false };
const rows = [
  { id: "printer-one", name: "Reception", status: "online" },
  { id: "printer-two", name: "Kitchen", status: "busy" },
];
const tableResult = (records = rows, hasMore = false) => ({ tables, selected: "printers", columns: tables[0].columns, rows: records, hasMore });

describe("platform operational status presentation", () => {
  it("groups related navigation once even when links arrive interleaved", async () => {
    await render(h(PlatformSidebar, { children: h("main", null, "Page"), onLogout: vi.fn(), loggingOut: false, items: [
      { href: "/platform/dashboard", label: "Overview", section: "Operations" },
      { href: "/platform/integrations", label: "Integration control", section: "Security" },
      { href: "/platform/fleet", label: "Fleet control", section: "Operations" },
      { href: "/platform/audit", label: "Audit log", section: "Security" },
    ] }));
    const nav = host.querySelector("nav")!;
    expect([...nav.querySelectorAll(".tg-sidebar-label")].map((item) => item.textContent)).toEqual(["Operations", "Security"]);
    const groups = nav.querySelectorAll("ul");
    expect([...groups[0].querySelectorAll("a")].map((item) => item.textContent)).toEqual(["Overview", "Fleet control"]);
    expect([...groups[1].querySelectorAll("a")].map((item) => item.textContent)).toEqual(["Integration control", "Audit log"]);
  });

  it("renders authoritative counts without claiming submission proves printing or busy devices are ready", async () => {
    fetchMock.mockResolvedValue(response({
      tenants: { total: 8, active: 7, suspended: 1 },
      agents: { active: 6, online: 5, offline: 1, unknown: 0 },
      printers: { active: 10, online: 4, busy: 3, offline: 1, error: 1, unknown: 1 },
      queueNow: { queued: 25, inFlight: 2 },
      jobs24h: { total: 100, success: 73, failed: 4, expired: 1 },
      subscriptions: { attention: 2 }, integrations: { keys: { active: 3 } },
    }));
    await render(h(PlatformDashboardPage));
    const metrics = [...host.querySelectorAll("section a")];
    expect(metrics.find((tile) => tile.textContent?.includes("Submissions completed in 24h"))?.textContent).toContain("73");
    expect(metrics.find((tile) => tile.textContent?.includes("Online / busy printers"))?.textContent).toContain("7");
    expect(host.textContent).not.toContain("Jobs printed in 24h");
    expect(host.textContent).toContain("Paper output is not independently verified");
  });

  it.each([
    ["en", "Submission completed · paper unverified", "Unknown outcome", "Inspect details", "Paper output unverified"],
    ["ar", "اكتمل الإرسال · الورق غير مؤكد", "النتيجة غير معروفة", "عرض التفاصيل", "خروج الورق غير مؤكد"],
  ] as const)("uses canonical %s outcome labels in the rows and diagnostics", async (locale, success, unknown, inspect, paper) => {
    fetchMock.mockResolvedValue(response({ jobs: [
      { id: "job-one", tenantId: "tenant-one", tenantName: "Synthetic workspace", printerId: "printer-one", printerName: "Reception", agentId: "agent-one", agentName: "Front desk", destination: "receipt", documentType: "pdf", status: "success", physicalOutcome: "unknown", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:01Z", archived: true },
      { id: "job-two", tenantId: "tenant-one", tenantName: "Synthetic workspace", printerId: "printer-one", agentId: "agent-one", status: "failed", physicalOutcome: "unknown", error: "UNKNOWN_PARTIAL_DELIVERY", createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-01T10:00:01Z", archived: false },
    ], hasMore: false }));
    await render(h(PlatformPrintOperationsPage), locale);
    const jobRows = host.querySelectorAll("tbody tr");
    expect(jobRows[0].textContent).toContain(success);
    expect(jobRows[1].textContent).toContain(unknown);
    expect(jobRows[1].textContent).not.toContain("UNKNOWN_PARTIAL_DELIVERY");
    expect(jobRows[0].querySelector(".tg-status-pill:last-child")?.className).not.toContain("bg-ok-bg");
    await click(button(inspect));
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(success);
    expect(dialog.textContent).toContain(paper);
    expect(dialog.textContent).not.toMatch(/Physical outcome:\s*unknown/);
  });
});

describe("database explorer interactions", () => {
  it("announces initial loading and an empty table catalog", async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await render(h(PlatformDatabasePage));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Loading tables");
    await act(async () => resolve(response({ ...catalog, tables: [] })));
    expect(host.textContent).toContain("No available tables");
  });

  it("labels pagination and search controls and submits human-friendly search with a reset page", async () => {
    fetchMock.mockResolvedValueOnce(response(catalog)).mockResolvedValue(response(tableResult(rows, true)));
    await render(h(PlatformDatabasePage));
    await click(button("printers3 visible columns"));
    await click(button("Next page"));
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("offset=25");
    const input = host.querySelector<HTMLInputElement>('input[placeholder="Search by name, status or partial ID"]')!;
    await enter(input, "Reception");
    await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const request = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "https://local.invalid");
    expect(request.searchParams.get("q")).toBe("Reception");
    expect(request.searchParams.get("offset")).toBe("0");
    expect(button("Previous page").disabled).toBe(true);
    const results = await axe.run(host, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations.map((item) => item.id)).toEqual([]);
  });

  it("closes record details when refreshing so a changed row order cannot retarget the inspected record", async () => {
    fetchMock.mockResolvedValueOnce(response(catalog)).mockResolvedValueOnce(response(tableResult())).mockResolvedValue(response(tableResult([...rows].reverse())));
    await render(h(PlatformDatabasePage));
    await click(button("printers3 visible columns"));
    await click(button("Details"));
    expect(host.textContent).toContain("Record details");
    await click(button("Refresh"));
    expect(host.textContent).not.toContain("Record details");
    expect(host.querySelector("tbody tr")?.textContent).toContain("Kitchen");
  });

  it("reports an unavailable clipboard without throwing or claiming a copy succeeded", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    fetchMock.mockResolvedValueOnce(response(catalog)).mockResolvedValue(response(tableResult()));
    await render(h(PlatformDatabasePage));
    await click(button("printers3 visible columns"));
    await click(button("Copy ID"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Copy failed");
    expect(host.textContent).not.toContain("ID copied");
  });
});

describe("bounded operational search", () => {
  it.each([
    ["fleet", PlatformFleetPage],
    ["integrations", PlatformIntegrationsPage],
    ["jobs", PlatformPrintOperationsPage],
  ] as const)("explains short %s queries and clears obsolete network errors without making a request", async (_label, Page) => {
    fetchMock.mockResolvedValue(response({}, 503));
    await render(h(Page));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const input = host.querySelector<HTMLInputElement>("input")!;
    await enter(input, "R");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Enter at least two characters");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
