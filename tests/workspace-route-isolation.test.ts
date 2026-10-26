// @vitest-environment jsdom
import { act, createElement as h, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSegmentKey } from "next/dist/client/components/router-reducer/create-segment-key";
import WorkspaceDetail from "../src/app/platform/tenants/[id]/page";

const fixture = vi.hoisted(() => ({ request: vi.fn(), a: (key: string) => key,
  format: (value: unknown) => String(value ?? "") }));
vi.mock("../src/components/platform/ManualAdmin", () => ({
  adminJson: fixture.request, controlClass: "control",
  useAdminText: () => ({ a: fixture.a, formatNumber: fixture.format, formatDate: fixture.format, formatDateTime: fixture.format }),
  AdminMetric: ({ label, value }: { label: string; value: ReactNode }) => h("p", null, label, value),
  AdminStatus: ({ status }: { status: string }) => h("span", null, status),
}));
vi.mock("../src/components/ui", () => ({
  Button: ({ loading: _loading, variant: _variant, ...props }: Record<string, unknown>) => h("button", props),
  Card: ({ children }: { children: ReactNode }) => h("div", null, children),
  PageHeader: ({ title }: { title: string }) => h("h1", null, title),
}));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => h("a", props) }));
vi.mock("../src/components/platform/PlatformTeamManagement", () => ({ PlatformTeamManagement: () => null }));

const subscription = (id: string) => ({ planId: `plan-${id}`, planName: `Plan ${id}`, status: "active", effectiveStatus: "active",
  subscriptionType: "paid", monthlyQuota: 1000, term: "monthly", currentPeriodStart: "2026-10-01T00:00:00Z",
  currentPeriodEnd: "2026-11-01T00:00:00Z", cancelAtPeriodEnd: false, internalReference: null,
  revision: 1, monthlyUsed: 0, nextReset: "2026-11-01T00:00:00Z" });
const detail = (id: string) => ({ workspace: { id, name: `Workspace ${id}`, lifecycle: "active", created_at: "2026-10-01", updated_at: "2026-10-01" },
  subscription: subscription(id), members: [], agents: [], printers: [], installations: [], credentials: [], jobs: [], events: [], history: [], requests: [],
  usage: { today: 0, month: 0, year: 0, monthlyHistory: [] } });
const plans = ["A", "B"].map(id => ({ id: `plan-${id}`, name: `Plan ${id}`, description: "", entitlements: { max_prints_per_period: 1000 }, isActive: true, isPublic: true, displayOrder: 0 }));
const params = (id: string) => Object.assign(Promise.resolve({ id }), { status: "fulfilled", value: { id } });
let root: Root, host: HTMLDivElement;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === label)!;
async function render(id: string) {
  // Next16.4.2 layout-router uses this exact installed key for dynamic segments.
  // It deliberately omits the param value, so A→B retains the outer page state.
  await act(async () => root.render(h(WorkspaceDetail, { key: createSegmentKey(["id", id, "d", null]), params: params(id) })));
}
async function enter(node: HTMLTextAreaElement | HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fixture.request.mockReset(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("resets the exact workspace data, subscription draft and password before the next workspace loads", async () => {
  let resolveB!: (value: ReturnType<typeof detail>) => void;
  const pendingB = new Promise<ReturnType<typeof detail>>(resolve => { resolveB = resolve; });
  fixture.request.mockImplementation((url: string) => url === "/api/platform/plans" ? Promise.resolve({ plans })
    : url.endsWith("/A") ? Promise.resolve(detail("A")) : pendingB);
  expect(createSegmentKey(["id", "A", "d", null])).toBe(createSegmentKey(["id", "B", "d", null]));
  await render("A");
  await act(async () => button("subscriptions").click());
  await enter(host.querySelector("textarea")!, "A private draft");
  await act(async () => button("preview").click());
  await enter(host.querySelector('input[type="password"]')!, "A private password");
  expect(host.textContent).toContain("A private draft");
  await render("A");
  expect(host.textContent).toContain("A private draft");
  expect(host.querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("A private password");
  await render("B");
  expect(host.textContent).not.toContain("Workspace A");
  expect(host.textContent).not.toContain("A private draft");
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(button("confirm")).toBeUndefined();
  await act(async () => resolveB(detail("B")));
  expect(host.textContent).toContain("Workspace B");
  await act(async () => button("subscriptions").click());
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(host.querySelector("textarea")!.value).toBe("");
  expect(host.querySelector("select")!.value).toBe("save");
});
