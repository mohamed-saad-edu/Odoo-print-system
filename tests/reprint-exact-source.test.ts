import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), create: vi.fn() }));
vi.mock("../src/db", () => ({ db: { query: { printJobs: { findFirst: mocks.lookup } } } }));
vi.mock("../src/lib/console-auth", () => ({
  validateConsoleAuth: async () => ({ kind: "manager", claims: { tenantId: "tenant", role: "owner", userId: "operator" } }),
}));
vi.mock("../src/lib/authorization", () => ({ requireManagerPermission: () => {} }));
vi.mock("../src/lib/print-job-service", () => ({
  createPrintJobForPrinter: mocks.create,
  PrintJobInputError: class extends Error {},
  PrintJobCapabilityError: class extends Error {},
  AgentQueueFullError: class extends Error {},
  AgentQueuedJobsFullError: class extends Error {},
}));

import { POST } from "../src/app/api/jobs/[id]/reprint/route";

const request = (jobId: string) => POST(
  // Route params are supplied separately by Next.js; keep the URL valid even
  // when exercising a malformed raw route parameter (e.g. an unpaired surrogate).
  new Request("https://gateway.test/api/jobs/placeholder/reprint", { method: "POST" }),
  { params: Promise.resolve({ id: jobId }) },
);

describe("operator reprint exact source identity", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it.each([" job_original", "job_original ", "\u00a0job_original", "job_original\u00a0", "bad\njob", "\ud800", ""])(
    "rejects malformed source identity %j before any job read or physical operation", async jobId => {
      const response = await request(jobId);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_REQUEST", retryable: false });
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  it("uses the exact job ID with the tenant-scoped lookup and creates one intentional reprint", async () => {
    const job = { id: "job_original", tenantId: "tenant", printerId: "printer", status: "failed",
      payload: { type: "raw", protocol: "raw", encoding: "base64", data: "SGVsbG8=" },
      destination: "receipt", documentType: "receipt" };
    mocks.lookup.mockResolvedValueOnce(job);
    mocks.create.mockResolvedValueOnce({ id: "new-reprint", isReused: false });
    const response = await request(job.id);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ ok: true, jobId: "new-reprint", reused: false });
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledWith("printer", job.payload, expect.objectContaining({
      tenantId: "tenant", reprintOfJobId: "job_original", requestedBy: "manager-reprint",
    }));
  });
});
