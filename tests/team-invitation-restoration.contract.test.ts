import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(path, "utf8");

describe("restored, single-role team invitations", () => {
  it("keeps the invitations card, pending-list, and send/revoke interactions on the workspace Team page", () => {
    const page = read("src/app/team/page.tsx");
    expect(page).toContain('t("team.inviteTitle")');
    expect(page).toContain('t("team.pendingInvitations")');
    expect(page).toContain('t("team.inviteSubmit")');
    expect(page).toContain('t("team.revoke")');
    expect(page).toContain('/api/team/invitations?limit=');
    expect(page).not.toContain("<Select");
    expect(page).not.toContain("updateRole(");
    expect(page).not.toContain('role: "viewer"');
  });
  it("proves the platform-owner identity with a password and uses the existing Platform invitation API", () => {
    const page = read("src/app/team/page.tsx");
    expect(page).toContain('"/api/platform/auth/me"');
    expect(page).toContain('"/api/platform/auth/login"');
    expect(page).toContain('"/api/platform/auth/reauth"');
    expect(page).toContain('"/api/platform/tenants/');
    expect(page).toContain('JSON.stringify({ email: invitedEmail })');
    expect(page).not.toContain('"/api/team/invitations", {');
    const existing = read("src/app/api/platform/tenants/[id]/invitations/route.ts");
    expect(existing).toContain("requirePlatformOwner(req)");
    expect(existing).toContain("requirePlatformActorInTransaction");
    expect(existing).toContain('role: "admin"');
    expect(existing).toContain("sendTransactionalEmail");
    expect(existing).toContain("INVITATION_DELIVERY_UNAVAILABLE");
  });
  it("returns read-only, scoped, bounded pending invitations without granting workspace write authority", () => {
    const route = read("src/app/api/team/invitations/route.ts");
    expect(route).toContain('export async function GET(req: Request)');
    expect(route).toContain('hasManagerPermission(claims, "users.read")');
    expect(route).toContain('eq(tenantInvitations.tenantId, claims.tenantId)');
    expect(route).toContain('isNull(tenantInvitations.revokedAt)');
    expect(route).toContain('clampListLimit(searchParams.get("limit"), 50, 100)');
    expect(route).toContain("hasMore: rows.length > limit");
    expect(route).toContain('PLATFORM_OWNER_REQUIRED');
    expect(route).not.toContain("sendTransactionalEmail");
  });
  it("uses database platform-owner identity for account and team badges, never workspace role=owner", () => {
    const settings = read("src/app/api/settings/route.ts");
    const members = read("src/app/api/team/members/route.ts");
    const team = read("src/app/team/page.tsx");
    const account = read("src/app/settings/page.tsx");
    expect(settings).toContain("isPlatformOwner");
    expect(settings).toContain("emailVerifiedAt");
    expect(settings).toContain("platformOwner:");
    expect(members).toContain("isPlatformOwner");
    expect(members).toContain("emailVerifiedAt");
    expect(team).toContain('t("team.platformOwner")');
    expect(team).toContain('t("v4.team.fullAccess")');
    expect(account).toContain('t("team.platformOwner")');
    expect(account).toContain("roleLabel(role, t)");
    expect(team).not.toContain('member.role === "owner"');
  });
  it("keeps the platform-owner title localized in English and Arabic", () => {
    expect(read("src/i18n/messages/en.ts")).toContain('"team.platformOwner": "Platform Owner"');
    expect(read("src/i18n/messages/ar.ts")).toContain('"team.platformOwner": "مالك المنصة"');
  });
});
