import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  permission: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
  transaction: vi.fn(),
  tenantGuard: vi.fn(),
  actorGuard: vi.fn(),
  tx: {},
}));

vi.mock("../src/lib/manager-auth", () => ({
  validateWorkspaceManager: mocks.authenticate,
}));
vi.mock("../src/lib/authorization", () => ({
  requireManagerPermission: mocks.permission,
}));
vi.mock("../src/lib/agent-health", () => ({
  getAllAgentsHealth: mocks.list,
  getAgentHealth: mocks.detail,
}));
vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../src/lib/tenant-guard", () => ({
  requireActiveTenantInTransaction: mocks.tenantGuard,
  TenantSuspendedError: class TenantSuspendedError extends Error { readonly code = "TENANT_SUSPENDED"; readonly status = 403; },
  TenantDeletedError: class TenantDeletedError extends Error { readonly code = "TENANT_DELETED"; readonly status = 403; },
}));
vi.mock("../src/lib/manager-mutation-authorization", () => ({
  requireManagerActorInTransaction: mocks.actorGuard,
  ManagerMutationAuthorityChangedError: class ManagerMutationAuthorityChangedError extends Error {
    response() { return Response.json({ code: "SESSION_EXPIRED" }, { status: 401 }); }
  },
}));

import { GET } from "../src/app/api/agents/health/route";

const urlFor = (field: "limit" | "offset", value: string) => {
  const url = new URL("http://gateway.test/api/agents/health");
  url.searchParams.set(field, value);
  return new Request(url);
};

describe("agent health read pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Keep the real route/guard call sequence, but supply a transaction
    // harness so this unit test does not require a production PostgreSQL DB.
    mocks.transaction.mockImplementation(async (fn: (tx: object) => Promise<unknown>) => fn(mocks.tx));
    mocks.tenantGuard.mockResolvedValue(undefined);
    mocks.actorGuard.mockResolvedValue(undefined);
    mocks.authenticate.mockResolvedValue({ tenantId: "tenant-a", role: "full_access" });
    mocks.permission.mockImplementation(() => {});
    mocks.list.mockResolvedValue([{ agentId: "first", tenantId: "tenant-a" }]);
    mocks.detail.mockResolvedValue(null);
  });

  it.each(["", "1e1", "1.0", " 1", "+2", "-0", "0x10", "Infinity", "9007199254740993"])(
    "rejects malformed limit token %j without consulting fleet data",
    async (value) => {
      const response = await GET(urlFor("limit", value));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_PAGINATION" });
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it.each(["", "1e1", "1.0", " 1", "+2", "-0", "0x10", "Infinity", "9007199254740993"])(
    "rejects malformed offset token %j without consulting fleet data",
    async (value) => {
      const response = await GET(urlFor("offset", value));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_PAGINATION" });
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it("keeps the existing default and accepted explicit page bounds", async () => {
    const defaults = await GET(new Request("http://gateway.test/api/agents/health"));
    expect(defaults.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith("tenant-a", 101, 0, mocks.tx);
    const valid = await GET(new Request("http://gateway.test/api/agents/health?limit=200&offset=100000"));
    expect(valid.status).toBe(200);
    expect(mocks.list).toHaveBeenLastCalledWith("tenant-a", 201, 100_000, mocks.tx);
    expect(valid.headers.get("x-page-limit")).toBe("200");
    expect(valid.headers.get("x-page-offset")).toBe("100000");
  });

  it("returns only the requested page and advertises the next page when a lookahead Agent exists", async () => {
    mocks.list.mockResolvedValueOnce([
      { agentId: "agent-2", tenantId: "tenant-a" },
      { agentId: "agent-3", tenantId: "tenant-a" },
    ]);
    const first = await GET(new Request("http://gateway.test/api/agents/health?limit=1&offset=2"));
    expect(first.status).toBe(200);
    expect(mocks.list).toHaveBeenLastCalledWith("tenant-a", 2, 2, mocks.tx);
    expect(mocks.tenantGuard).toHaveBeenCalledWith(mocks.tx, "tenant-a");
    expect(mocks.actorGuard).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ tenantId: "tenant-a" }), "agents.read");
    expect((await first.json())).toEqual([{ agentId: "agent-2", tenantId: "tenant-a" }]);
    expect(first.headers.get("x-has-more")).toBe("true");
    expect(first.headers.get("x-next-offset")).toBe("3");

    mocks.list.mockResolvedValueOnce([{ agentId: "agent-3", tenantId: "tenant-a" }]);
    const last = await GET(new Request("http://gateway.test/api/agents/health?limit=1&offset=3"));
    expect(last.status).toBe(200);
    expect((await last.json())).toEqual([{ agentId: "agent-3", tenantId: "tenant-a" }]);
    expect(last.headers.get("x-has-more")).toBe("false");
    expect(last.headers.get("x-next-offset")).toBeNull();
  });

  it.each(["limit=0", "limit=201", "offset=100001"])(
    "rejects out-of-bound page %s", async (params) => {
      const response = await GET(new Request("http://gateway.test/api/agents/health?" + params));
      expect(response.status).toBe(400);
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );


  it("marks the authenticated Agent-health inventory and all denials private no-store", async () => {
    const requests = [
      new Request("http://gateway.test/api/agents/health"),
      new Request("http://gateway.test/api/agents/health?limit=1e1"),
      new Request("http://gateway.test/api/agents/health?agentId=unknown"),
    ];
    for (const request of requests) {
      const response = await GET(request);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    mocks.authenticate.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).headers.get("Cache-Control")).toBe("private, no-store");
    mocks.permission.mockImplementationOnce(() => { throw new Error("Forbidden"); });
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("does not authorize or query on unauthenticated or forbidden reads", async () => {
    mocks.authenticate.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).status).toBe(401);
    mocks.permission.mockImplementationOnce(() => { throw new Error("Forbidden"); });
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
