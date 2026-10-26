// @vitest-environment jsdom
import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  root: null as Root | null,
  origin: "https://first.example.test",
  jobs: [] as Array<Record<string, unknown>>,
  jobReads: 0,
  failInventory: false,
  saveNotificationFails: false,
}));

vi.mock("react-dom/client", async (original) => {
  const client = await original<typeof import("react-dom/client")>();
  return { ...client, createRoot: (...args: Parameters<typeof client.createRoot>) => {
    fixture.root = client.createRoot(...args);
    return fixture.root;
  } };
});

// Mock only the native/HTTP boundary. The App, pages, drawers, state updates,
// translation and physical-outcome presentation all execute unchanged.
vi.mock("../src/desktop/lib/ipc", async (original) => ({
  ...await original<typeof import("../src/desktop/lib/ipc")>(),
  isTauri: true,
  getGatewayUrl: async () => fixture.origin,
  setGatewayUrl: async (origin: string) => {
    fixture.origin = origin;
    if (fixture.saveNotificationFails) throw new Error("Gateway saved but change notification failed");
    return "saved";
  },
  getAgentStatus: async () => ({ running: true, note_code: "service_running", hostname: "synthetic-host" }),
  getAppVersion: async () => "test",
  getRuntimePaths: async () => null,
  getAutostart: async () => ({ enabled: false }),
  isRunningAsAdmin: async () => true,
  setTrayLocale: async () => undefined,
  onTrayNavigate: async () => () => {},
  onTrayRestartAgent: async () => () => {},
  onGatewayConfigChanged: async () => () => {},
  getPrinters: async () => [],
  probeGatewayHealth: async () => ({ ok: true, service: "yaseir-print-gateway" }),
  fetchGatewayPrinters: async () => {
    if (fixture.failInventory) throw new Error("Paired Agent origin does not match");
    return [{ id: "printer-first", name: "First Gateway printer", status: "unknown", enabled: true, lifecycle: "active" }];
  },
  fetchGatewayAgents: async () => [],
  fetchGatewayJobs: async () => {
    fixture.jobReads += 1;
    if (fixture.failInventory) throw new Error("Paired Agent origin does not match");
    return structuredClone(fixture.jobs);
  },
}));

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function navigate(page: string) {
  await act(async () => {
    window.location.hash = page;
    window.dispatchEvent(new Event("hashchange"));
  });
  await flush();
}

async function click(button: HTMLButtonElement | null | undefined) {
  expect(button).toBeTruthy();
  await act(async () => { button!.click(); });
  await flush();
}

function jobDrawer() {
  return document.querySelector('[role="dialog"][aria-label="Job details"]');
}

beforeEach(async () => {
  vi.resetModules();
  fixture.origin = "https://first.example.test";
  fixture.jobs = [{ id: "job-live", printerId: "printer-first", documentType: "receipt", status: "printing", createdAt: "2026-10-25T01:00:00Z", updatedAt: "2026-10-25T01:00:00Z" }];
  fixture.jobReads = 0;
  fixture.failInventory = false;
  fixture.saveNotificationFails = false;
  document.body.innerHTML = '<div id="root"></div>';
  window.localStorage.clear();
  window.location.hash = "jobs";
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { await import("../src/desktop/main"); });
  await flush();
});

afterEach(async () => {
  await act(async () => { fixture.root?.unmount(); });
  fixture.root = null;
  document.body.innerHTML = "";
});

describe("Desktop detail identity follows current Gateway evidence", () => {
  it("labels the editable Windows queue when no discovered spooler can be selected", async () => {
    await navigate("printers");
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Manual printer setup"));
    const controls = document.querySelectorAll("#pp-spooler");
    expect(controls).toHaveLength(1);
    expect(controls[0].tagName).toBe("INPUT");
    const input = controls[0] as HTMLInputElement;
    expect(input.labels?.length).toBe(1);
    expect(input.labels?.[0].textContent?.trim()).toBeTruthy();
    expect(input.labels?.[0].control).toBe(input);
    const activated = vi.fn();
    input.addEventListener("click", activated);
    await act(async () => { input.labels?.[0].click(); });
    // JSDOM forwards label activation but does not implement native focus
    // movement (also reproducible on a plain label/input outside this App).
    expect(activated).toHaveBeenCalledOnce();
  });

  it("updates an open job drawer when the Gateway reports an uncertain physical outcome", async () => {
    const details = [...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Details");
    await click(details);
    expect(jobDrawer()?.textContent).toContain("job-live");
    expect(jobDrawer()?.textContent).not.toContain("Outcome unknown - paper may have printed");

    fixture.jobs = [{ ...fixture.jobs[0], status: "failed", error: "UNKNOWN_PARTIAL_DELIVERY: acknowledgment lost", updatedAt: "2026-10-25T01:01:00Z" }];
    const before = fixture.jobReads;
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Refresh all"]'));
    expect(fixture.jobReads).toBeGreaterThan(before);
    expect(jobDrawer()?.textContent).toContain("Outcome unknown - paper may have printed");
    expect(jobDrawer()?.textContent).toContain("Automatic retry is paused to prevent duplicate printing");
    expect(jobDrawer()?.textContent).not.toContain("The job failed before printing started.");
  });

  it("closes an open job drawer when the current snapshot no longer contains its job", async () => {
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Details"));
    expect(jobDrawer()).not.toBeNull();
    fixture.jobs = [];
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Refresh all"]'));
    expect(jobDrawer()).toBeNull();
  });

  it("keeps file-only drawer outcomes out of the physical print timeline", async () => {
    fixture.jobs = [{ ...fixture.jobs[0], status: "success", outputMedium: "file", outputEvidence: null }];
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Refresh all"]'));
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Details"));
    expect(jobDrawer()?.textContent).toContain("PDF file creation is not confirmed");
    expect(jobDrawer()?.textContent).not.toContain("Sent to printer");
    expect(jobDrawer()?.querySelector('[role="group"]')).toBeNull();
    expect(jobDrawer()?.textContent).not.toContain("The print service accepted the job");
  });

  it("preserves safe failed-file details without exposing local paths or paper guidance", async () => {
    fixture.jobs = [{ ...fixture.jobs[0], status: "failed", outputMedium: "file", outputEvidence: null, error: "write C:\\private\\output.pdf: access is denied; secret=hidden" }];
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Refresh all"]'));
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Details"));
    expect(jobDrawer()?.textContent).toContain("Check the permissions of the approved output directory.");
    expect(jobDrawer()?.textContent).not.toContain("private");
    expect(jobDrawer()?.textContent).not.toContain("secret=hidden");
    expect(jobDrawer()?.textContent).not.toContain("Sent to printer");
    expect(jobDrawer()?.querySelector('[role="group"]')).toBeNull();
  });

  it.each(["LATE_SUCCESS:", "LATE_SUCCESS_POST_EXPIRATION:"])("keeps reconciled submission guidance for %s", async marker => {
    fixture.jobs = [{ ...fixture.jobs[0], status: "success", error: `${marker} Original AGENT_EXECUTION_TIMEOUT; the original Agent confirmed submission` }];
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Refresh all"]'));
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Details"));
    expect(jobDrawer()?.textContent).toContain("Sent to printer");
    expect(jobDrawer()?.textContent).toContain("The print service accepted the job; paper output is not verified.");
    expect(jobDrawer()?.textContent).not.toContain("Printer did not respond in time.");
    expect(jobDrawer()?.textContent).not.toContain("The printer operation could not be completed.");
    expect(jobDrawer()?.textContent).not.toContain("Print completed");
  });

  it("drops the previous Gateway inventory when a committed origin change loses its notification", async () => {
    await navigate("printers");
    expect(document.querySelector("main")?.textContent).toContain("First Gateway printer");
    await navigate("settings");
    const input = document.querySelector<HTMLInputElement>("#gw-url")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "https://second.example.test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    fixture.failInventory = true;
    fixture.saveNotificationFails = true;
    await click([...document.querySelectorAll<HTMLButtonElement>("main button")].find((button) => button.textContent === "Check connection"));
    expect(fixture.origin).toBe("https://second.example.test");
    await navigate("printers");
    expect(document.querySelector("main")?.textContent).not.toContain("First Gateway printer");
  });
});
