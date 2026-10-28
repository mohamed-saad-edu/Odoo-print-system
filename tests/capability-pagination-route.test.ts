import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real HTTP route's current transaction and live-actor boundary.
// Mock only PostgreSQL execution; stale non-transactional helper mocks used to
// hide session/tenant fences and made the collection test unrelated to the route.
const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  single: vi.fn(),
  auth: vi.fn(),
  permission: vi.fn(),
  transaction: vi.fn(),
  activeTenant: vi.fn(),
  liveActor: vi.fn(),
  steps: [] as string[],
}));
const fakeTx = { connection: "same-transaction" };
vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../src/lib/manager-auth", () => ({ validateWorkspaceManager: mocks.auth }));
vi.mock("../src/lib/authorization", () => ({ requireManagerPermission: mocks.permission }));
vi.mock("../src/lib/tenant-guard", () => ({
  requireActiveTenantInTransaction: mocks.activeTenant,
  TenantSuspendedError: class TenantSuspendedError extends Error {},
  TenantDeletedError: class TenantDeletedError extends Error {},
}));
vi.mock("../src/lib/manager-mutation-authorization", () => ({
  requireManagerActorInTransaction: mocks.liveActor,
  ManagerMutationAuthorityChangedError: class ManagerMutationAuthorityChangedError extends Error {
    response() { return new Response(null, { status: 403 }); }
  },
}));
vi.mock("../src/lib/printer-health", () => ({
  getPrinterCapabilityPageInTransaction: mocks.page,
  getPrinterCapabilityMatrixInTransaction: mocks.single,
}));

import { GET } from "../src/app/api/printers/capabilities/route";

describe("capability collection keyset contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.steps.length = 0;
    mocks.auth.mockResolvedValue({ tenantId: "tenant-a", role: "admin" });
    mocks.permission.mockImplementation(() => {});
    mocks.transaction.mockImplementation(async (callback: (tx: typeof fakeTx) => Promise<unknown>) => {
      mocks.steps.push("begin");
      const result = await callback(fakeTx);
      mocks.steps.push("commit");
      return result;
    });
    mocks.activeTenant.mockImplementation(async () => { mocks.steps.push("tenant"); });
    mocks.liveActor.mockImplementation(async () => { mocks.steps.push("actor"); });
    mocks.page.mockImplementation(async () => {
      mocks.steps.push("page");
      return { items: [{ printerId: "printer-a" }], hasMore: true, nextCursor: "cHJpbnRlci1h" };
    });
    mocks.single.mockImplementation(async () => {
      mocks.steps.push("single");
      return { printerId: "printer-a" };
    });
  });

  it("keeps the response array and cursor behind current tenant and actor fences in one transaction", async () => {
    const response = await GET(new Request("http://gateway.test/api/printers/capabilities?limit=2&after=cHJpbnRlci0w"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ printerId: "printer-a" }]);
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.activeTenant).toHaveBeenCalledWith(fakeTx, "tenant-a");
    expect(mocks.liveActor).toHaveBeenCalledWith(fakeTx, expect.objectContaining({ tenantId: "tenant-a" }), "printers.read");
    expect(mocks.page).toHaveBeenCalledWith(fakeTx, "tenant-a", { limit: 2, afterId: "printer-0" });
    expect(mocks.steps).toEqual(["begin", "tenant", "actor", "page", "commit"]);
    expect(response.headers.get("X-Has-More")).toBe("true");
    expect(response.headers.get("X-Next-Cursor")).toBe("cHJpbnRlci1h");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it.each(["!", "", "a", "_w", "YQ==", "a".repeat(641)])("rejects invalid cursor %s before querying", async (cursor) => {
    const response = await GET(new Request(`http://gateway.test/api/printers/capabilities?after=${encodeURIComponent(cursor)}`));
    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it("keeps exact direct lookup tenant-scoped behind the same live authorization", async () => {
    const response = await GET(new Request("http://gateway.test/api/printers/capabilities?printerId=printer-a"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ printerId: "printer-a" });
    expect(mocks.single).toHaveBeenCalledWith(fakeTx, "tenant-a", "printer-a");
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.steps).toEqual(["begin", "tenant", "actor", "single", "commit"]);
  });

  it("does not read capabilities when a previously authenticated actor is revoked at the transaction boundary", async () => {
    mocks.liveActor.mockRejectedValueOnce(new Error("revalidated session is revoked"));
    const response = await GET(new Request("http://gateway.test/api/printers/capabilities"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.steps).toEqual(["begin", "tenant", "actor"]);
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it("denies unauthenticated callers before opening a capability transaction", async () => {
    mocks.auth.mockResolvedValue(null);
    const response = await GET(new Request("http://gateway.test/api/printers/capabilities"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("preserves RBAC refusal before a capability read", async () => {
    mocks.permission.mockImplementation(() => { throw new Error("Forbidden"); });
    const response = await GET(new Request("http://gateway.test/api/printers/capabilities"));
    expect(response.status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
