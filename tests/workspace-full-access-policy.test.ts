import { describe, expect, it, vi } from "vitest";
vi.mock("../src/lib/manager-auth", () => ({
  validateWorkspaceManager: async () => ({ userId: "user-A", tenantId: "workspace-A", role: "admin" }),
}));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hasManagerPermission, managerPermissions, type ManagerPermission } from "../src/lib/authorization";
import type { ManagerClaims, ManagerRole } from "../src/lib/manager-auth";

const roles: ManagerRole[] = ["owner", "admin", "operator", "viewer", "integration_admin", "billing_admin"];
const claims = (role: ManagerRole) => ({
  role, tenantId: "workspace-A", userId: "user-A",
  sub: "manager", jti: "test-access-control-jti", iat: 10, exp: 300,
} as ManagerClaims);
const allowed: ManagerPermission[] = [
  "tenant.read", "tenant.update", "users.read",
  "agents.read", "agents.pair", "agents.disable", "agents.retire",
  "printers.read", "printers.manage", "printers.test",
  "jobs.read", "jobs.payload.read", "jobs.create", "jobs.retry", "jobs.cancel",
  "bindings.read", "bindings.manage", "integrations.read", "integrations.manage",
];
const forbidden: ManagerPermission[] = ["users.manage", "billing.read", "billing.manage"];

describe("one operational Full Access for every workspace membership", () => {
  it.each(roles)("grants all printing/Agent/integration capabilities to %s", role => {
    for (const permission of allowed) expect(hasManagerPermission(claims(role), permission)).toBe(true);
    expect(new Set(managerPermissions(claims(role)))).toEqual(new Set(allowed));
  });
  it.each(roles)("%s has no team, billing, or workspace ownership mutation authority", role => {
    for (const permission of forbidden) expect(hasManagerPermission(claims(role), permission)).toBe(false);
  });
  it("unknown role never acquires authority", () => {
    const unknown = claims("unknown" as ManagerRole);
    expect(managerPermissions(unknown)).toEqual([]);
    for (const permission of allowed) expect(hasManagerPermission(unknown, permission)).toBe(false);
  });
  it("workspace mutation routes deny direct HTTP bypass for all logged-in members", async () => {
    const { POST: invite } = await import("../src/app/api/team/invitations/route");
    const { PATCH: changeRole, DELETE: removeMember } = await import("../src/app/api/team/members/route");
    const { POST: transfer } = await import("../src/app/api/team/ownership/route");
    const { POST: subscribe, GET: billingRequests } = await import("../src/app/api/subscription-requests/route");
    const request = new Request("https://gateway.example.test/api/team/invitations", { method: "POST" });
    expect((await invite(request)).status).toBe(403);
    expect((await changeRole(request)).status).toBe(403);
    expect((await removeMember(request)).status).toBe(403);
    expect((await transfer(request)).status).toBe(403);
    expect((await subscribe(request)).status).toBe(403);
    expect((await billingRequests(request)).status).toBe(403);
  });
  it("removes legacy role choices from the workspace team page and requires platform proof", () => {
    const page = readFileSync(join(process.cwd(), "src/app/team/page.tsx"), "utf8");
    const platform = readFileSync(join(process.cwd(), "src/app/api/platform/tenants/[id]/invitations/route.ts"), "utf8");
    const sql = readFileSync(join(process.cwd(), "drizzle/0096_retire_limited_workspace_roles.sql"), "utf8");
    expect(page).not.toMatch(/ROLE_VALUES|roleOptions\(|updateRole\(|<Select/);
    expect(page).not.toContain("/api/team/invitations");
    expect(platform).toContain("requirePlatformActorInTransaction");
    expect(platform).toContain("assertPlatformTeamOrigin");
    expect(platform).toContain('role: "admin"');
    expect(sql).toContain("workspace_role_cutover");
    expect(sql).toContain("ALTER TABLE tenant_invitations ADD CONSTRAINT tenant_invitations_role_check CHECK (role='admin')");
  });
});
