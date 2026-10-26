import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { tenantInvitations, tenants, tenantUsers, users, emailVerificationTokens } from "../src/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { generateOpaqueToken, hashToken } from "../src/lib/password";
import { applyMigrations, closePool, hasTestDatabase, truncateAll, pool } from "./helpers/pg";
import { POST as accept } from "../src/app/api/team/invitations/accept/route";
import { GET as preview } from "../src/app/api/team/invitations/preview/route";
import { POST as verify } from "../src/app/api/auth/verify-email/route";
import { findActiveInvitation, joinWorkspaceByInvitation } from "../src/lib/invitation-join";

const emails = vi.hoisted(() => ({ sent: vi.fn(async (_input: unknown) => {}) }));
vi.mock("../src/lib/email", () => ({
  appBaseUrl: () => "https://gateway.test",
  sendTransactionalEmail: emails.sent,
}));
const suite = describe.skipIf(!hasTestDatabase);
const baseUrl = "https://gateway.test";

async function fixture(opts: { invitedAccount?: "verified" | "unverified" } = {}) {
  const suffix = generateOpaqueToken().slice(0, 10);
  const tenantId = `tenant_company_${suffix}`;
  const inviterId = `usr_owner_${suffix}`;
  const inviteeId = `usr_friend_${suffix}`;
  const email = `friend-${suffix.toLowerCase()}@example.test`;
  const token = generateOpaqueToken();
  await db.insert(tenants).values({ id: tenantId, name: "Customer Company" });
  await db.insert(users).values({ id: inviterId, email: `owner-${suffix.toLowerCase()}@example.test`, passwordHash: "unused", emailVerifiedAt: new Date() });
  await db.insert(tenantUsers).values({ tenantId, userId: inviterId, role: "owner" });
  if (opts.invitedAccount) await db.insert(users).values({ id: inviteeId, email, passwordHash: "unused",
    emailVerifiedAt: opts.invitedAccount === "verified" ? new Date() : null });
  const invitationId = `inv_${suffix}`;
  await db.insert(tenantInvitations).values({
    id: invitationId, tenantId, inviterUserId: inviterId, email,
    role: "admin", tokenHash: await hashToken(token),
    expiresAt: new Date(Date.now() + 3600_000),
  });
  return { email, tenantId, inviteeId, invitationId, token };
}

suite("company invitation onboarding", () => {
  beforeAll(async () => { await applyMigrations(); });
  beforeEach(async () => { await truncateAll(); emails.sent.mockClear(); });
  afterAll(async () => { await closePool(); });

  it("shows company + invited mailbox without requiring an account or workspace ID", async () => {
    const f = await fixture();
    const res = await preview(new Request(`${baseUrl}/api/team/invitations/preview?token=${encodeURIComponent(f.token)}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toMatchObject({ workspaceName: "Customer Company", email: f.email, role: "admin" });
  });

  it("automatically seeds an unverified identity, then adds it ONLY to the invited tenant after mailbox proof", async () => {
    const f = await fixture();
    const acceptRes = await accept(new Request(`${baseUrl}/api/team/invitations/accept`, {
      method: "POST", body: JSON.stringify({ token: f.token }),
    }));
    expect(acceptRes.status).toBe(202);
    expect((await acceptRes.json()).code).toBe("VERIFICATION_SENT");
    const identity = await db.query.users.findFirst({ where: eq(users.email, f.email) });
    expect(identity?.emailVerifiedAt).toBeNull();
    expect(identity?.id).toBeTruthy();
    expect((await db.select().from(tenants)).map(t => t.id)).toEqual([f.tenantId]);
    expect((await db.select().from(tenantUsers)).map(m => m.userId)).toEqual([expect.any(String)]); // only original owner
    const pending = await db.query.emailVerificationTokens.findFirst({
      where: eq(emailVerificationTokens.userId, identity!.id),
    });
    expect(pending?.invitationId).toBe(f.invitationId);
    const mail = emails.sent.mock.calls.at(-1)?.[0] as { html?: string };
    const href = mail.html?.match(/href="([^"]+)"/)?.[1];
    expect(href).toBeTruthy();
    const proof = new URL(href!);
    expect(proof.pathname).toBe("/verify-email");
    // Deliberately remove &invite=: server-side invitation binding must still
    // force membership in Customer Company and never auto-create a new tenant.
    const verifyRes = await verify(new Request(`${baseUrl}/api/auth/verify-email`, {
      method: "POST", body: JSON.stringify({ token: proof.searchParams.get("token") }),
    }));
    expect(verifyRes.status).toBe(200);
    expect((await verifyRes.json()).invitationJoined).toBe(true);
    const membership = await db.query.tenantUsers.findFirst({
      where: and(eq(tenantUsers.userId, identity!.id), eq(tenantUsers.tenantId, f.tenantId)),
    });
    expect(membership?.role).toBe("admin");
    expect((await db.select().from(tenants)).length).toBe(1);
    expect((await db.query.tenantInvitations.findFirst({ where: eq(tenantInvitations.id, f.invitationId) }))?.acceptedAt).toBeTruthy();
    const replay = await accept(new Request(`${baseUrl}/api/team/invitations/accept`, {
      method: "POST", body: JSON.stringify({ token: f.token }),
    }));
    expect(replay.status).toBe(400);
  });

  it("rejects invalid/revoked invites before proving email, without creating a new workspace", async () => {
    const f = await fixture();
    expect((await accept(new Request(`${baseUrl}/api/team/invitations/accept`, {
      method: "POST", body: JSON.stringify({ token: f.token }),
    }))).status).toBe(202);
    const mail = emails.sent.mock.calls.at(-1)?.[0] as { html?: string };
    const proof = new URL(mail.html!.match(/href="([^"]+)"/)![1]);
    await db.update(tenantInvitations).set({ revokedAt: sql`clock_timestamp()` })
      .where(eq(tenantInvitations.id, f.invitationId));
    const response = await verify(new Request(`${baseUrl}/api/auth/verify-email`, {
      method: "POST", body: JSON.stringify({ token: proof.searchParams.get("token") }),
    }));
    expect(response.status).toBe(409);
    expect((await db.select().from(tenants)).length).toBe(1);
    const identity = await db.query.users.findFirst({ where: eq(users.email, f.email) });
    expect(identity?.emailVerifiedAt).toBeNull();
    expect(await db.query.tenantUsers.findFirst({
      where: and(eq(tenantUsers.userId, identity!.id), eq(tenantUsers.tenantId, f.tenantId)),
    })).toBeUndefined();
  });

  it("does not let a bearer token silently join an existing verified account without its session", async () => {
    const f = await fixture({ invitedAccount: "verified" });
    const response = await accept(new Request(`${baseUrl}/api/team/invitations/accept`, {
      method: "POST", body: JSON.stringify({ token: f.token }),
    }));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("SIGN_IN_REQUIRED");
    expect(await db.query.tenantUsers.findFirst({
      where: and(eq(tenantUsers.userId, f.inviteeId), eq(tenantUsers.tenantId, f.tenantId)),
    })).toBeUndefined();
    expect((await db.query.tenantInvitations.findFirst({ where: eq(tenantInvitations.id, f.invitationId) }))?.acceptedAt).toBeNull();
  });
  it("adds an existing verified account to the invited company, never as owner, and consumes only one token", async () => {
    const f = await fixture({ invitedAccount: "verified" });
    const invitation = await findActiveInvitation(f.token);
    expect(invitation?.tenantId).toBe(f.tenantId);
    const joined = await db.transaction(tx =>
      joinWorkspaceByInvitation(tx, invitation!, f.inviteeId, f.email));
    expect(joined).toEqual({ tenantId: f.tenantId, role: "admin" });
    const rows = await db.select().from(tenantUsers);
    expect(rows).toHaveLength(2);
    expect(rows.find(m => m.userId === f.inviteeId)).toMatchObject({ tenantId: f.tenantId, role: "admin" });
    expect((await db.select().from(tenants)).length).toBe(1);
    await expect(db.transaction(tx =>
      joinWorkspaceByInvitation(tx, invitation!, f.inviteeId, f.email)))
      .rejects.toThrow("INVITATION_INVALID");
  });

  it("cannot join a verified global account with a different email", async () => {
    const f = await fixture({ invitedAccount: "verified" });
    const invitation = await findActiveInvitation(f.token);
    await expect(db.transaction(tx =>
      joinWorkspaceByInvitation(tx, invitation!, f.inviteeId, "someone-else@example.test")))
      .rejects.toThrow("INVITATION_INVALID");
    expect((await db.query.tenantInvitations.findFirst({
      where: eq(tenantInvitations.id, f.invitationId),
    }))?.acceptedAt).toBeNull();
  });

});
