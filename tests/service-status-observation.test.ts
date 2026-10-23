import { describe, expect, it, vi } from "vitest";

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
  it("keeps an unobserved SCM failure flag unknown in the blocked response", async () => {
    const response = await GET(new Request("https://gateway.example/api/agents/service-status?agentId=agent-test"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.blocked).toBe(true);
    expect(body.state).toBe("UNKNOWN");
    expect(body.recovery.failureFlag).toBeNull();
    expect(body.failureCount).toBeNull();
    expect(body.exitCode).toBeNull();
  });
});
