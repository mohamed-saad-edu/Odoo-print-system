import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasManagerPermission } from "../src/lib/authorization";
import type { ManagerClaims } from "../src/lib/manager-auth";

const read = (path: string) => readFileSync(path, "utf8");

describe("Gateway customer and Platform Admin remain separate", () => {
  it("renders workspace subscription status and requests, never a platform redirect", () => {
    const billing = read("src/app/billing/page.tsx");
    expect(billing).toContain("verifyWorkspaceTokenFromCookieValues(");
    expect(billing).toContain("BillingActions");
    expect(billing).not.toContain('redirect("/platform/subscriptions")');
    expect(billing).toContain("customerSubscriptionState");
  });

  it("the owner can request, but cannot activate a subscription", () => {
    const request = read("src/app/api/subscription-requests/route.ts");
    expect(request).toContain("validateWorkspaceManager(req)");
    expect(request).toContain("requireManagerActorInTransaction(tx,actor");
    expect(request).toContain("requireIdempotencyKey(req)");
    expect(request).toContain("ensurePendingManualSubscription");
    expect(request).not.toContain('code: "PLATFORM_OWNER_REQUIRED"');
    expect(hasManagerPermission({ role: "owner" } as ManagerClaims, "billing.read")).toBe(true);
    expect(hasManagerPermission({ role: "owner" } as ManagerClaims, "billing.manage")).toBe(false);
    for (const role of ["admin", "viewer", "operator", "billing_admin", "integration_admin"] as const) {
      expect(hasManagerPermission({ role } as ManagerClaims, "billing.read")).toBe(false);
    }
    expect(read("src/app/api/platform/tenants/[id]/subscription/route.ts")).toContain("requirePlatformOwner");
  });

  it("private billing controls appear only for the workspace owner", () => {
    const settings = read("src/app/settings/page.tsx");
    const keys = read("src/app/api-keys/page.tsx");
    expect(settings).toContain('role === "owner" && <Button href="/billing"');
    expect(keys).toContain('setCanReadBilling(principal.permissions?.includes("billing.read") === true)');
    expect(keys).toContain('action={canReadBilling ? (');
    expect(keys).toContain('href="/billing"');
    expect(keys).not.toContain('href="/onboarding"');
  });

  it("navigation never crosses into platform admin for workspace subscription flows", () => {
    const shell = read("src/components/AppShell.tsx");
    const dashboard = read("src/app/dashboard/dashboard-client.tsx");
    const onboarding = read("src/app/onboarding/page.tsx");
    expect(shell).toContain('href: "/billing"');
    expect(shell).not.toContain('href: "/platform/subscriptions"');
    expect(dashboard).toContain('router.replace("/billing")');
    expect(dashboard).not.toContain('router.replace("/onboarding")');
    expect(onboarding).toContain('redirect("/billing"');
  });

  it("removes invitations from platform administration but preserves workspace team", () => {
    const detail = read("src/app/platform/tenants/[id]/page.tsx");
    const platformInvitations = read("src/app/api/platform/tenants/[id]/invitations/route.ts");
    const team = read("src/app/team/page.tsx");
    const workspaceInvites = read("src/app/api/team/invitations/route.ts");
    expect(detail).not.toContain("PlatformTeamManagement");
    expect(detail).toContain("table(data.members");
    expect(platformInvitations).toContain("status: 410");
    expect(platformInvitations).not.toContain("sendTransactionalEmail");
    expect(team).toContain('fetchWithTimeout("/api/team/invitations"');
    expect(workspaceInvites).toContain("requireWorkspacePlatformOwnerForInvites(tx, claims)");
    expect(workspaceInvites).toContain("INVITATION_DELIVERY_UNAVAILABLE");
  });
});
