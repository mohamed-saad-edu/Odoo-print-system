import { describe, expect, it } from "vitest";
import { PATCH, DELETE } from "../src/app/api/team/members/route";

describe("retired workspace role mutations cannot be revived by stale sessions", () => {
  it("denies a direct role PATCH without touching a database or revoking another member", async () => {
    const response = await PATCH(new Request("http://gateway.test/api/team/members", {
      method: "PATCH", body: JSON.stringify({ userId: "any", role: "owner" }),
    }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "PLATFORM_OWNER_REQUIRED" });
  });
  it("denies a direct member removal regardless of the old actor role", async () => {
    const response = await DELETE(new Request("http://gateway.test/api/team/members?userId=any", { method: "DELETE" }));
    expect(response.status).toBe(403);
  });
});
