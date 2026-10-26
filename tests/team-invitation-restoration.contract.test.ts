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
  it("uses the verified Platform Owner workspace session without another password prompt", () => {
    const page = read("src/app/team/page.tsx");
    const route = read("src/app/api/team/invitations/route.ts");
    const guard = read("src/lib/workspace-owner-invitations.ts");
    expect(page).toContain('fetchWithTimeout("/api/team/invitations"');
    expect(page).not.toContain("verifyPlatformOwnerPassword");
    expect(page).not.toContain('type="password"');
    expect(route).toContain("assertPlatformTeamOrigin(req)");
    expect(route).toContain("requireWorkspacePlatformOwnerForInvites(tx, claims)");
    expect(route).toContain('role: "admin"');
    expect(route).toContain("sendTransactionalEmail");
    expect(route).toContain("INVITATION_DELIVERY_UNAVAILABLE");
    expect(guard).toContain('requireManagerActorInTransaction(tx, claims, "users.read")');
    expect(guard).toContain("u.is_platform_owner=true");
    expect(guard).toContain("u.email_verified_at IS NOT NULL");
    const platform = read("src/app/api/platform/tenants/[id]/invitations/route.ts");
    expect(platform).toContain("requirePlatformOwner(req)");
    expect(platform).toContain("requirePlatformActorInTransaction");
  });
  it("lists scoped, bounded pending invitations without exposing tokens", () => {
    const route = read("src/app/api/team/invitations/route.ts");
    expect(route).toContain('export async function GET(req: Request)');
    expect(route).toContain('hasManagerPermission(claims, "users.read")');
    expect(route).toContain('eq(tenantInvitations.tenantId, claims.tenantId)');
    expect(route).toContain('isNull(tenantInvitations.revokedAt)');
    expect(route).toContain('clampListLimit(searchParams.get("limit"), 50, 100)');
    expect(route).toContain("hasMore: rows.length > limit");
    expect(route).toContain('export async function POST(req: Request)');
    expect(route).toContain('export async function DELETE(req: Request)');
    expect(route).not.toContain("tokenHash: tenantInvitations.tokenHash");
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
    expect(team).toContain('t("team.role.owner")');
    expect(team).toContain('icon={<Crown className="h-3.5 w-3.5 text-warn" aria-hidden />}');
    expect(team).toContain('label={member.platformOwner ? t("team.role.owner")');
    expect(team).not.toContain('label={t("team.platformOwner")}');
    expect(team).toContain('t("v4.team.fullAccess")');
    expect(account).toContain('t("team.role.owner")');
    expect(account).toContain("roleLabel(role, t)");
    expect(team).not.toContain('member.role === "owner"');
  });
  it("keeps the platform-owner title localized in English and Arabic", () => {
    expect(read("src/i18n/messages/en.ts")).toContain('"team.platformOwner": "Platform Owner"');
    expect(read("src/i18n/messages/ar.ts")).toContain('"team.platformOwner": "مالك المنصة"');
  });
});
