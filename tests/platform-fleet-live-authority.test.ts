import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  guard: vi.fn(),
  transaction: vi.fn(),
  select: vi.fn(),
  query: vi.fn(),
  clock: vi.fn(),
}));

vi.mock("../src/lib/platform-auth", () => ({
  requirePlatformOwner: mocks.auth,
  requirePlatformReadAuthorityInTransaction: mocks.guard,
  PlatformUnauthorizedError: class PlatformUnauthorizedError extends Error {},
}));
vi.mock("../src/db", () => ({ db: { transaction: mocks.transaction } }));
vi.mock("../src/db/client", () => ({ queryWithTimeout: mocks.query }));
vi.mock("../src/lib/database-clock", async importActual => ({
  ...await importActual<typeof import("../src/lib/database-clock")>(),
  databaseNowMs: mocks.clock,
}));

import { GET } from "../src/app/api/platform/fleet/route";
import { PlatformUnauthorizedError } from "../src/lib/platform-auth";

describe("cross-tenant Platform fleet inventory read fence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ userId: "platform-owner" });
    mocks.guard.mockResolvedValue(undefined);
    mocks.clock.mockResolvedValue(Date.now());
    mocks.query.mockImplementation(async (fn: () => unknown) => fn());
    mocks.select.mockReturnValue({ from: () => ({ innerJoin: () => ({
      where: () => ({ orderBy: () => ({ limit: () => ({ offset: async () => [] }) }) }),
    }) }) });
    mocks.transaction.mockImplementation(async (fn: (tx: {select: typeof mocks.select}) => unknown) => fn({ select: mocks.select }));
  });

  it.each(["agents", "printers"] as const)("guards %s inventory until the selected rows are read", async kind => {
    const response = await GET(new Request("http://gateway.test/api/platform/fleet?kind=" + kind));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ kind, items: [] });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.guard).toHaveBeenCalledOnce();
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(mocks.select.mock.invocationCallOrder[0]);
  });

  it.each(["agents", "printers"] as const)("denies %s after the owner's authorization was revoked", async kind => {
    mocks.guard.mockRejectedValueOnce(new PlatformUnauthorizedError());
    const response = await GET(new Request("http://gateway.test/api/platform/fleet?kind=" + kind));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
