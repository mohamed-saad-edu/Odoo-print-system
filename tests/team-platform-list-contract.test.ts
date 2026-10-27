import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseStrictListOffset } from "../src/lib/request-limits";

const mocks = vi.hoisted(() => ({ workspace: vi.fn(), platform: vi.fn(), query: vi.fn() }));
vi.mock("../src/lib/manager-auth", () => ({ validateWorkspaceManager: mocks.workspace }));
vi.mock("../src/lib/platform-auth", () => ({
  requirePlatformOwner: mocks.platform,
  PlatformUnauthorizedError: class PlatformUnauthorizedError extends Error {},
}));
vi.mock("../src/db/client", () => ({ queryWithTimeout: mocks.query }));

import { GET as listMembers } from "../src/app/api/team/members/route";
import { GET as listInvitations } from "../src/app/api/team/invitations/route";
import { GET as listWorkspaces } from "../src/app/api/platform/tenants/route";

const lists = [
  ["workspace members", "/api/team/members", listMembers],
  ["pending invitations", "/api/team/invitations", listInvitations],
  ["platform workspaces", "/api/platform/tenants", listWorkspaces],
] as const;

describe("authenticated directory pagination and privacy", () => {
  beforeEach(() => {
    mocks.workspace.mockReset().mockResolvedValue({ tenantId: "tenant-a", role: "owner", userId: "owner-a" });
    mocks.platform.mockReset().mockResolvedValue(undefined);
    mocks.query.mockReset().mockResolvedValue([]);
  });

  it("defines one exact decimal offset parser used by all directory endpoints", () => {
    for (const malformed of ["", " ", " 4", "4 ", "+1", "-1", "2.5", "1e2", "0x20", "15junk", "1000001", "9007199254740992"]) {
      expect(parseStrictListOffset(malformed, 1_000_000), malformed).toBeNull();
    }
    expect(parseStrictListOffset(null, 1_000_000)).toBe(0);
    expect(parseStrictListOffset("0002", 1_000_000)).toBe(2);
    expect(parseStrictListOffset("1000000", 1_000_000)).toBe(1_000_000);
  });

  for (const [label, path, handler] of lists) {
    it.each(["", " ", " 4", "4 ", "+1", "-1", "2.5", "1e2", "0x20", "15junk", "1000001", "9007199254740992"])(
      `${label}: rejects malformed offset %s before any query`, async value => {
        const url = new URL(`http://gateway.test${path}`);
        url.searchParams.set("offset", value);
        const response = await handler(new Request(url));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "INVALID_OFFSET" });
        expect(mocks.query).not.toHaveBeenCalled();
      },
    );
  }

  it.each([
    ["workspace members", "/api/team/members", listMembers],
    ["platform workspaces", "/api/platform/tenants", listWorkspaces],
  ] as const)("%s: authenticated lists are private and uncacheable", async (_label, path, handler) => {
    const response = await handler(new Request(`http://gateway.test${path}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.query).toHaveBeenCalled();
  });
});
