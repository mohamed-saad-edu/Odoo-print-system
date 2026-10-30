import type * as PrintJobServiceModule from "../src/lib/print-job-service";
import type * as DatabaseClockModule from "../src/lib/database-clock";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ select: vi.fn(), transaction: vi.fn(), createJob: vi.fn(), event: vi.fn(), now: vi.fn() }));
vi.mock("../src/db", () => ({ db: { select: mocks.select, transaction: mocks.transaction } }));
vi.mock("../src/lib/manager-auth", () => ({ validateWorkspaceManager: async () => ({ tenantId: "tenant", userId: "operator", role: "owner" }) }));
vi.mock("../src/lib/authorization", () => ({ requireManagerPermission: () => {} }));
vi.mock("../src/lib/printer-health", () => ({
  getPrinterCapabilityMatrix: async () => ({ documentTypes: ["pdf"] }),
  getPrinterCapabilityMatrixInTransaction: async () => ({ documentTypes: ["pdf"] }),
}));
vi.mock("../src/lib/console-read-authority", () => ({ requireConsoleReadAuthorityInTransaction: async () => undefined }));
vi.mock("../src/lib/print-job-service", async (original) => ({
  ...(await original<typeof PrintJobServiceModule>()), createPrintJobForPrinter: mocks.createJob,
}));
vi.mock("../src/lib/database-clock", async (original) => ({
  ...(await original<typeof DatabaseClockModule>()), databaseNowMs: mocks.now,
}));
vi.mock("../src/lib/job-timeline", () => ({ recordJobEvent: mocks.event }));

import { POST } from "../src/app/api/printers/[id]/certify/route";
import { TenantPrintQuotaExceededError } from "../src/lib/entitlements";

const now = new Date("2026-10-15T12:00:00Z");
const printer = { id: "selected", tenantId: "tenant", agentId: "agent", name: "Installed queue",
  connectionType: "spooler", protocol: "spooler", capabilities: null, config: { spooler_name: "Installed queue" } };

function replyRows(job: Record<string, unknown>, agent: Record<string, unknown> = { id: "agent", lastSeenAt: now }) {
  const rows = [[printer], [job], [agent]];
  mocks.select.mockImplementation(() => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }) }));
}

async function certify(body?: string) {
  return POST(new Request("https://gateway.test/api/printers/selected/certify", {
    method: "POST", headers: { "Idempotency-Key": "same-operation", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body }),
  }), { params: Promise.resolve({ id: "selected" }) });
}

describe("certification evidence and request handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation: (tx: object) => Promise<unknown>) => operation({ select: mocks.select }));
    mocks.now.mockResolvedValue(now.getTime());
    mocks.createJob.mockResolvedValue({ id: "job", status: "queued", isReused: true });
    mocks.event.mockResolvedValue(undefined);
  });

  it.each([" padded-operation ", "   ", "bad\noperation", "\uFEFFpadded-operation"])(
    "rejects a noncanonical caller-supplied certification key %j without creating any print intent",
    async (key) => {
      replyRows({ id: "job", status: "queued" });
      const response = await POST(new Request("https://gateway.test/api/printers/selected/certify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idempotencyKey: key }),
      }), { params: Promise.resolve({ id: "selected" }) });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("INVALID_REQUEST");
      expect(mocks.createJob).not.toHaveBeenCalled();
    },
  );

  it("rejects conflicting header and body operation identities before certification admission", async () => {
    replyRows({ id: "job", status: "queued" });
    const response = await POST(new Request("https://gateway.test/api/printers/selected/certify", {
      method: "POST",
      headers: { "Idempotency-Key": "header-operation", "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "different-body-operation", testPage: true }),
    }), { params: Promise.resolve({ id: "selected" }) });
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      retryable: false,
      steps: expect.arrayContaining([expect.objectContaining({ id: "queue", status: "error" })]),
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("accepts identical header and body operation identities without minting a new key", async () => {
    replyRows({ id: "job", status: "queued" });
    const response = await POST(new Request("https://gateway.test/api/printers/selected/certify", {
      method: "POST",
      headers: { "Idempotency-Key": "shared-operation-id", "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: "shared-operation-id", testPage: true }),
    }), { params: Promise.resolve({ id: "selected" }) });
    expect(response.status).toBe(200);
    expect(mocks.createJob).toHaveBeenCalledWith("selected", expect.anything(),
      expect.objectContaining({ idempotencyKey: "shared-operation-id", tenantId: "tenant" }));
  });

  it("refuses a physical certification without a caller-owned idempotency key", async () => {
    replyRows({ id: "job", status: "queued" });
    const response = await POST(new Request("https://gateway.test/api/printers/selected/certify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testPage: true }),
    }), { params: Promise.resolve({ id: "selected" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED", retryable: false,
      steps: expect.arrayContaining([expect.objectContaining({ id: "queue", status: "error" })]),
    });
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("accepts an empty POST without Content-Length using the same canonical diagnostic pipeline", async () => {
    replyRows({ id: "job", status: "queued" });
    const response = await certify();
    expect(response.status).toBe(200);
    expect(mocks.createJob).toHaveBeenCalledOnce();
    const result = await response.json();
    expect(result).toMatchObject({ jobId: "job", certified: false, blocked: true });
    expect(JSON.stringify(result)).not.toContain("sandbox has no printer");
  });

  it("maps a depleted monthly quota to an explicit 429 instead of an internal failure", async () => {
    replyRows({ id: "job", status: "queued" });
    const cycleStart = new Date("2026-10-01T00:00:00.000Z");
    const cycleEnd = new Date("2026-11-01T00:00:00.000Z");
    mocks.createJob.mockRejectedValueOnce(new TenantPrintQuotaExceededError(5, 5, cycleStart, cycleEnd));
    const response = await certify("{}");
    expect(response.status).toBe(429);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Retry-After")).toBe(String(Math.ceil((cycleEnd.getTime() - now.getTime()) / 1000)));
    expect(await response.json()).toMatchObject({
      code: "PRINT_QUOTA_EXCEEDED",
      entitlement: "max_prints_per_period",
      limit: 5, used: 5, remaining: 0, upgradeRequired: true, retryable: false,
      periodStart: cycleStart.toISOString(), periodEnd: cycleEnd.toISOString(),
      steps: expect.arrayContaining([expect.objectContaining({ id: "queue", status: "blocked" })]),
    });
    expect(mocks.event).not.toHaveBeenCalled();
  });

  it("keeps malformed nonempty JSON from creating any physical intent", async () => {
    replyRows({ id: "job", status: "queued" });
    expect((await certify("{")).status).toBe(400);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });

  it("does not show an Agent claim or transport success for failure before claim", async () => {
    replyRows({ id: "job", status: "failed", error: "Expired without delivery" });
    const response = await certify("{}");
    const result = await response.json();
    const step = (id: string) => result.steps.find((entry: { id: string }) => entry.id === id);
    expect(step("claim").status).toBe("error");
    expect(step("agent").status).not.toBe("ok");
    expect(step("transport").status).not.toBe("ok");
    expect(step("final").status).toBe("error");
    expect(result.certified).toBe(false);
  });

  it("preserves an expired attempt's real claim evidence without treating it as printed", async () => {
    replyRows({ id: "job", status: "expired", claimedAt: now, claimToken: "live-attempt" });
    const result = await (await certify("{}")).json();
    expect(result.steps.find((entry: { id: string }) => entry.id === "claim").status).toBe("ok");
    expect(result.steps.find((entry: { id: string }) => entry.id === "final").status).toBe("error");
    expect(result.certified).toBe(false);
    expect(result.blocked).toBe(true);
  });

  it.each([
    ["future observation", { status: "online", lifecycle: "active", lastSeenAt: new Date(now.getTime() + 60_000) }],
    ["offline status", { status: "offline", lifecycle: "active", lastSeenAt: now }],
    ["disabled lifecycle", { status: "online", lifecycle: "disabled", lastSeenAt: now }],
    ["retired lifecycle", { status: "online", lifecycle: "retired", lastSeenAt: now }],
  ] as const)("does not label a queued job's Agent online with %s", async (_label, agent) => {
    replyRows({ id: "job", status: "queued" }, { id: "agent", ...agent });
    const result = await (await certify("{}")).json();
    const step = result.steps.find((entry: { id: string }) => entry.id === "agent");
    expect(step.status).toBe("blocked");
    expect(step.message).not.toContain("Agent online");
    expect(result.certified).toBe(false);
  });

  it("keeps a current active online Agent pending until the job is claimed", async () => {
    replyRows({ id: "job", status: "queued" }, { id: "agent", status: "online", lifecycle: "active", lastSeenAt: now });
    const result = await (await certify("{}")).json();
    const step = result.steps.find((entry: { id: string }) => entry.id === "agent");
    expect(step.status).toBe("pending");
    expect(step.message).toContain("Agent online");
    expect(result.certified).toBe(false);
  });
});
