import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenant: vi.fn(), row: vi.fn(), rows: vi.fn(), receipts: vi.fn(),
}));
vi.mock("../src/lib/odoo-auth", () => ({ validateOdooKey: vi.fn(async () => ({ id: "key", tenantId: "tenant" })) }));
vi.mock("../src/db", () => {
  const db = { query: {
    tenants: { findFirst: state.tenant },
    printJobs: { findFirst: state.row, findMany: state.rows },
    printJobReceipts: { findFirst: state.row, findMany: state.receipts },
  }, transaction: async (fn: (tx: unknown) => unknown) => fn(db) };
  return { db };
});

import { GET as lookup } from "../src/app/api/print/jobs/route";
import { GET as lookupV2 } from "../src/app/api/print/jobs/v2/route";
import { POST as batch } from "../src/app/api/print/jobs/batch-status/route";

describe("strict installation status authority is not client-selectable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tenant.mockResolvedValue({ id: "tenant", odooIdempotencyMode: "strict_v2" });
    state.row.mockResolvedValue({ id: "private-job", status: "success" });
    state.rows.mockResolvedValue([{ id: "private-job", status: "success" }]);
    state.receipts.mockResolvedValue([]);
  });

  it.each([["legacy URL", lookup], ["v2 URL", lookupV2]] as const)("rejects missing proof before reading a job at %s", async (_name, get) => {
    const response = await get(new Request("https://gateway.test/api/print/jobs?id=private-job"));
    expect(response.status).toBe(403);
    expect(state.row).not.toHaveBeenCalled();
  });

  it("rejects missing batch proof before reading job metadata", async () => {
    const response = await batch(new Request("https://gateway.test/api/print/jobs/batch-status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobIds: ["private-job"] }),
    }));
    expect(response.status).toBe(403);
    expect(state.rows).not.toHaveBeenCalled();
  });
});
