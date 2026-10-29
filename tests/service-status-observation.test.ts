import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), transaction: vi.fn() }));
vi.mock("../src/db", () => ({ db: {
  transaction: mocks.transaction,
}}));
vi.mock("../src/lib/tenant-guard", () => ({
  requireActiveTenantInTransaction: vi.fn(async () => {}),
  TenantSuspendedError: class extends Error {},
  TenantDeletedError: class extends Error {},
}));
vi.mock("../src/lib/manager-mutation-authorization", () => ({
  requireManagerActorInTransaction: vi.fn(async () => {}),
  ManagerMutationAuthorityChangedError: class extends Error {},
}));
vi.mock("../src/lib/authorization", () => ({ requireManagerPermission: () => {} }));
vi.mock("../src/lib/manager-auth", () => ({
  validateWorkspaceManager: vi.fn(async () => ({
    jti: "service-status-test",
    iat: 1,
    exp: 4_000_000_000,
    sub: "manager",
    tenantId: "tenant-service-status",
    userId: "owner-service-status",
    role: "owner",
    ver: 2,
    kind: "manager",
    sid: "session-service-status",
    familyId: "family-service-status",
  })),
}));

import { GET } from "../src/app/api/agents/service-status/route";

describe("service recovery observations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute: mocks.execute, query: { agents: { findFirst: async () => ({ id: "agt_five8900" }) } } }));
  });

  it("keeps an unobserved SCM failure flag unknown in the blocked response", async () => {
    const response = await GET(new Request("https://gateway.example/api/agents/service-status?agentId=agt_five8900"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.blocked).toBe(true);
    expect(body.state).toBe("UNKNOWN");
    expect(body.recovery.failureFlag).toBeNull();
    expect(body.failureCount).toBeNull();
    expect(body.exitCode).toBeNull();
  });

  it("rejects an unowned or unknown agent identity without status metadata", async () => {
    mocks.transaction.mockImplementation(async () => {
      throw new Error("connection refused");
    });
    const response = await GET(new Request("https://gateway.example/api/agents/service-status?agentId=agt_five8900"));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "SERVICE_STATUS_UNAVAILABLE" });
  });
});
