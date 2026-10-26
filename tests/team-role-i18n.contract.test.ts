import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { roleLabel } from "../src/lib/roles";
const roles = ["owner", "admin", "operator", "viewer", "integration_admin", "billing_admin"];

describe("one translated operational Full Access label", () => {
  it.each(roles)("maps legacy %s membership to the same Full Access wording", role => {
    expect(roleLabel(role, key => key)).toBe("v4.team.fullAccess");
  });
  it("unknown role never receives a Full Access label", () => {
    expect(roleLabel("unexpected", key => key)).toBe("common.unknown");
  });
  it("team lists colleagues without selectable roles; settings use the same roleLabel", () => {
    const page = readFileSync("src/app/team/page.tsx", "utf8");
    const settings = readFileSync("src/app/settings/page.tsx", "utf8");
    expect(page).toContain('t("v4.team.fullAccess")');
    expect(page).not.toContain("<Select");
    expect(page).toContain("/api/team/invitations?limit=");
    expect(page).toContain('t("team.inviteTitle")');
    expect(page).toContain('t("team.platformOwner")');
    expect(settings).toContain("roleLabel(role, t)");
  });
});
