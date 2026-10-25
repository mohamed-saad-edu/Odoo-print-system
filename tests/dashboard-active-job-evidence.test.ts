// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import DashboardClient, { type Job } from "../src/app/dashboard/dashboard-client";
import { getDashboardJobsResult, getDashboardStateResult } from "../src/app/actions";

// Stable router identity prevents loading effects from retriggering on every render.
vi.mock("next/navigation", () => {
  const router = { replace() {}, refresh() {} };
  return { useRouter: () => router };
});
// The timeline has separate tests; keep this suite scoped to the inspector.
vi.mock("../src/components/JobTimeline", () => ({ default: () => null }));
vi.mock("../src/lib/session-config", () => ({ ensureCustomerSession: async () => ({ authenticated: true }) }));
vi.mock("../src/app/actions", () => ({
  getDashboardJobsResult: vi.fn(), getDashboardStateResult: vi.fn(), deleteAgentResult: vi.fn(),
  setAgentLifecycleResult: vi.fn(), setPrinterLifecycleResult: vi.fn(),
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.unstubAllGlobals();
});

const fleet = { pageSize: 100, agentOffset: 0, agentHasMore: false, printerOffset: 0,
  printerHasMore: false, totalAgents: 0, onlineAgents: 0, totalPrinters: 0, onlinePrinters: 0 };

async function inspect(status: string, error?: string) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const job: Job = { id: "job_evidence", agentId: "agent", printerId: "printer", status, error, createdAt: new Date().toISOString() };
  const jobs = [job];
  vi.mocked(getDashboardJobsResult).mockResolvedValue({ ok: true, data: jobs } as never);
  vi.mocked(getDashboardStateResult).mockResolvedValue({ ok: true, data: { agents: [], printers: [], jobs, fleet } } as never);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("/timeline") ? { timeline: [], status: "failed" } : job,
  ), { status: 200, headers: { "content-type": "application/json" } })));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(DashboardClient, {
    initialView: "jobs", initialAgents: [], initialPrinters: [], initialJobs: jobs, initialFleet: fleet, databaseError: null,
    canReadBillingUsage: false, diagnosticActorScope: "fixture",
    canMutate: { printers: false, printersTest: false, agentsPair: false, agentsLifecycle: false, jobsCancel: false, jobsRetry: true },
  })));
  const jobButton = host.querySelector<HTMLButtonElement>('button[title="job_evidence"]')!;
  expect(jobButton).toBeTruthy();
  await act(async () => jobButton.click());
  return document.querySelector('[role="dialog"]')?.textContent ?? "";
}

describe("dashboard active job evidence", () => {
  for (const status of ["claimed", "printing"]) {
    it(`does not present terminal reprint warnings for ${status}`, async () => {
      const text = await inspect(status);
      expect(text).toContain("Processing");
      expect(text).not.toContain("Verify the printer before reprinting");
      expect(text).not.toContain("This job may already have printed");
    });
  }
  it("retains duplicate-print warning for a terminal unknown failure", async () => {
    const text = await inspect("failed", "UNKNOWN_PARTIAL_DELIVERY: acknowledgment lost");
    expect(text).toContain("Verify the printer before reprinting");
    expect(text).toContain("This job may already have printed");
  });
});
