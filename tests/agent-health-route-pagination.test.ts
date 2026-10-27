import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  permission: vi.fn(),
  list: vi.fn(),
  detail: vi.fn(),
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

import { GET } from "../src/app/api/agents/health/route";

const urlFor = (field: "limit" | "offset", value: string) => {
  const url = new URL("http://gateway.test/api/agents/health");
  url.searchParams.set(field, value);
  return new Request(url);
};

describe("agent health read pagination", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
    expect(mocks.list).toHaveBeenCalledWith("tenant-a", 101, 0);
    const valid = await GET(new Request("http://gateway.test/api/agents/health?limit=200&offset=100000"));
    expect(valid.status).toBe(200);
    expect(mocks.list).toHaveBeenLastCalledWith("tenant-a", 201, 100_000);
    expect(valid.headers.get("x-page-limit")).toBe("200");
    expect(valid.headers.get("x-page-offset")).toBe("100000");
  });

  it.each(["limit=0", "limit=201", "offset=100001"])(
    "rejects out-of-bound page %s", async (params) => {
      const response = await GET(new Request("http://gateway.test/api/agents/health?" + params));
      expect(response.status).toBe(400);
      expect(mocks.list).not.toHaveBeenCalled();
    },
  );

  it("does not authorize or query on unauthenticated or forbidden reads", async () => {
    mocks.authenticate.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).status).toBe(401);
    mocks.permission.mockImplementationOnce(() => { throw new Error("Forbidden"); });
    expect((await GET(new Request("http://gateway.test/api/agents/health"))).status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
