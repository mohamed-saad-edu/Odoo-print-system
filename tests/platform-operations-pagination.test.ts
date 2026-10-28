import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("../src/lib/platform-auth", () => ({
  requirePlatformOwner: mocks.auth,
  PlatformUnauthorizedError: class PlatformUnauthorizedError extends Error {},
}));
vi.mock("../src/db/client", () => ({ queryWithTimeout: mocks.query }));
import { GET as readJobs } from "../src/app/api/platform/jobs/route";
import { GET as readIntegrations } from "../src/app/api/platform/integrations/route";

describe("platform owner operations pagination", () => {
  const routes = [
    ["jobs", "/api/platform/jobs", readJobs],
    ["integrations", "/api/platform/integrations", readIntegrations],
  ] as const;
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(undefined);
    mocks.query.mockReset().mockResolvedValue([]);
  });

  for (const [title, path, GET] of routes) {
    it.each(["", " ", " 1", "1 ", "+1", "-1", "2.5", "1e2", "0x10", "10garbage", "101", "9007199254740992"])(
      `${title}: rejects malformed/oversized limit %s without querying`, async value => {
        const url = new URL(`http://gateway.test${path}`);
        url.searchParams.set("limit", value);
        const response = await GET(new Request(url));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "INVALID_PAGINATION" });
        expect(mocks.query).not.toHaveBeenCalled();
      },
    );
    it.each(["", " ", " 1", "1 ", "+1", "-1", "2.5", "1e2", "0x10", "10garbage", "10001", "9007199254740992"])(
      `${title}: rejects malformed/oversized offset %s without querying`, async value => {
        const url = new URL(`http://gateway.test${path}`);
        url.searchParams.set("offset", value);
        const response = await GET(new Request(url));
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ code: "INVALID_PAGINATION" });
        expect(mocks.query).not.toHaveBeenCalled();
      },
    );
    it(`${title}: normalizes exact decimal pagination and keeps metadata private`, async () => {
      const response = await GET(new Request(`http://gateway.test${path}?limit=010&offset=001`));
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.json()).toMatchObject({ limit: 10, offset: 1 });
      expect(mocks.query).toHaveBeenCalled();
    });
  }
});
